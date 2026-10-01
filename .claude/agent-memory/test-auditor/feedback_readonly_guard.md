---
name: readonly-guard
description: guard-bash runs test-auditor read-only and blocks shell output redirection, a heredoc scratch script included; briefs say a guard block means stop and report, so plan analyses that write no files
metadata:
  type: feedback
---

On 2026-10-01 (STORE-01 audit), `cat > <scratchpad>/x.mjs <<'EOF'` was blocked: "test-auditor: read-only role, output
redirection to files is not allowed". The brief said a guard block means stop and report, never work around it,
even if the message suggests another route. So the scratch file was not created any other way (not with Write
either), and the block was reported in the findings.

**Why:** the owner wants guards to stay real. Routing around a block teaches that blocks are suggestions.
**How to apply:** default to analyses that write no files: grep, sed -n, and the repo's own `pnpm run` scripts. For
the ID check, grep the ID-shaped tokens and compare them with the rows of docs/requirements-status.md. Older
memories point to scratch harnesses (ta-*.mjs). Treat those as possibly unavailable under this guard, and say so if
an audit needs one and cannot write it.
Related: [[in-memory-mutation]], [[spike01-audit]]
