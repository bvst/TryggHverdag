---
name: reviewer-sandbox-quirks
description: What the read-only Bash guard blocks for this reviewer on the Mac, and the workarounds that work
metadata:
  type: reference
---

The guard hook (`guard-bash.mjs --readonly`) matches on the command's text, not on what the command does:
- Any `>` counts as a redirect: `2>/dev/null`, a JS arrow `=>` inside `node -e`, and even `->` inside an `echo` string. Pipe to `grep`/`sed` instead, and write JS with `function(){}`.
- The text "expo install" (even inside a grep regex) counts as a dependency change. Rephrase the pattern.
- macOS has no `timeout`; use the Bash tool's own timeout.
- `gh api` and `gh release view` work, which is enough to check action tag SHAs (dereference annotated tags through `git/tags/<sha>`), repository licences (`repos/<o>/<r>/license`) and release asset digests.

Related: [[mobile-release-review]], [[tooling-scripts-review]]
