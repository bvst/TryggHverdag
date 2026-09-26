---
name: gate-file-silent-success
description: pnpm run gate:file prints nothing but the pnpm banner when it passes — read the exit code; also macOS has no `timeout` binary
metadata:
  type: reference
---

`pnpm run gate:file <path>` (scripts/gate-file.mjs: prettier, eslint incl. the AR-03 rule, typecheck, dependency-cruiser for AR-10, related tests) prints only the pnpm header on success. Seen 2026-09-26.

**How to apply:** run it as `pnpm run gate:file <path>; echo "exit=$?"` and quote the exit code as the evidence. Don't read an empty output as "did not run". On the Mac (claude-dev), GNU `timeout` is not installed, so use the Bash tool's timeout parameter instead of wrapping commands. The code-reviewer role is read-only in Bash: guard-bash.mjs blocks output redirection such as `>>` or heredoc-to-file, so memory files must be written with Write or Edit. Related: [[spawned-process-tests]].

Two more guard quirks (2026-09-26, INF-06 review): an inline `node -e '…=>…'` is blocked because guard-bash reads the `>` in `=>` as a redirect. Write a probe script to the scratchpad with Write and run `node <file>`. That Write fires the post-edit hook, which runs gate:file on the scratchpad file and reports prettier/ESLint failures ("couldn't find an eslint.config"). The file is still written, and the failure is noise to ignore, not a problem in the repository.
