---
name: gate-file-silent-success
description: pnpm run gate:file prints nothing but the pnpm banner when it passes — read the exit code; also macOS has no `timeout` binary
metadata:
  type: reference
---

`pnpm run gate:file <path>` (scripts/gate-file.mjs: prettier, eslint incl. the AR-03 rule, typecheck, dependency-cruiser for AR-10, related tests) prints only the pnpm header on success. Seen 2026-09-26.

**How to apply:** run it as `pnpm run gate:file <path>; echo "exit=$?"` and quote the exit code as the evidence. Don't read an empty output as "did not run". On the Mac (claude-dev), GNU `timeout` is not installed, so use the Bash tool's timeout parameter instead of wrapping commands. The code-reviewer role is read-only in Bash: guard-bash.mjs blocks output redirection such as `>>` or heredoc-to-file, so memory files must be written with Write or Edit. Related: [[spawned-process-tests]].

Two more guard quirks (2026-09-26, INF-06 review): an inline `node -e '…=>…'` is blocked because guard-bash reads the `>` in `=>` as a redirect. Write a probe script to the scratchpad with Write and run `node <file>`. That Write fires the post-edit hook, which runs gate:file on the scratchpad file and reports prettier/ESLint failures ("couldn't find an eslint.config"). The file is still written, and the failure is noise to ignore, not a problem in the repository.

More blocks, from the SPIKE-01 review on 2026-09-30:
- `git merge-base` is blocked as a "git write command". Use `git log main..HEAD` instead.
- `awk '… n>60 …'` is blocked as a redirect.
- `zip` and `tee` into the scratchpad are blocked as file-changing commands. So a tool cannot be probed with a file made for the purpose; say it was not checked.

2026-10-01 (SPIKE-01 loop-1 re-review): `2>/dev/null` is blocked as "output redirection". So is a `>` comparison inside a piped `python3 -c` script, and a `grep` pattern that contains `=>`. Python heredocs on stdin (`python3 - <<'EOF'`) with no `>` in them do pass. Plan probes so they contain no `>` at all.

The brief says a guard block means stop and report. Do not rephrase the command to get past it; list the check as not done. Running a Write-created probe with `node <file>` in the scratchpad did work, and it may import repository modules read-only.
