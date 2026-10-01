---
name: reviewer-sandbox-quirks
description: What the read-only Bash guard blocks for this reviewer on the Mac, that a block ends the review, and the workarounds to plan in up front
metadata:
  type: reference
---

The guard hook (`guard-bash.mjs --readonly`) matches on the command's text, not on what the command does:
- Any `>` counts as a redirect: `2>/dev/null`, a JS arrow `=>` inside `node -e`, `->` inside an `echo` string, **and a `>` inside a grep regex** (`[^>]*`, `<application[^>]*>`; blocked on SPIKE-01, 2026-09-30). Pipe to `grep`/`sed` instead, write JS with `function(){}`, and for XML use patterns such as `android:name="[^"]*"` that need no `>`.
- **A `>` inside a sed replacement placeholder** (`s/[0-9.]+/<num>/g`) is blocked too. This happened on SPIKE-01 loop 1 (2026-10-01) and cost the coordinate search. Mask with `#` or `N`, never with `<...>`.
- Masking digits works for looking at evidence without quoting numbers: `sed -E 's/[0-9]/#/g'`. ugrep rejects `.{0,120}X.{0,120}` (its complexity limit), so split long JSON lines with `tr ',' '\n' | grep -n X` instead.
- The text "expo install" (even inside a grep regex) counts as a dependency change. Rephrase the pattern.
- **`cd <repo> && git merge-base --is-ancestor ...`** was blocked as "git write commands are not allowed" on SPIKE-01 loop 2 (2026-10-01). It is unclear whether the bare `cd` or the word `merge` caused it. Use `git -C <abs>` (it worked all review), and test ancestry with `git log --oneline A..B | grep <sha>` instead of `merge-base`.
- macOS has no `timeout`; use the Bash tool's own timeout.
- zsh expands a leading `=` in a word: `echo ====` fails with "=== not found" (STORE-01 re-check, 2026-10-01). Use `----` as a separator.
- `gh api` and `gh release view` work, which is enough to check action tag SHAs (dereference annotated tags through `git/tags/<sha>`), repository licences (`repos/<o>/<r>/license`) and release asset digests.

**A block ends the review.** Briefs say a guard block means stop and report, never rephrase and retry. So a careless `>` costs every check still to come. Before each command, scan it for `>`. Run the checks most likely to decide the verdict first.

Related: [[mobile-release-review]], [[tooling-scripts-review]], [[device-harness-review]]
