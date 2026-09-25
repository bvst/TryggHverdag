---
name: tooling-scripts-review
description: What to check when a PR only touches scripts/ tooling (doctor, gates) that shells out to gh/git/ssh/docker — the recurring leak and hang risks
metadata:
  type: feedback
---

Tooling-only PRs (scripts/doctor.mjs, gates) have no PRIV surface; the SEC questions are: is anything credential-bearing printed, is a shell involved, can a child hang.

**Why:** BUG-4 (2026-09-25) added `gh auth status`, `git remote get-url origin`, `ssh -T git@github.com` and a `node -e` probe to the doctor. It passed because: spawnSync with arg arrays (no shell), probe script a constant, only regex-captured account names printed (never raw gh output with its masked token line, never the remote URL which may embed `user:token@`), ssh with BatchMode=yes + ConnectTimeout + spawn timeout + stdin ignored.

**How to apply:** For similar PRs, check (1) raw output of `gh auth status` / remote URLs is never echoed — only parsed fields; (2) `shell: true` or string-built commands are absent; (3) every external call has a timeout and non-interactive stdin; (4) "first line of error" printers can't surface env secrets (DOCKER_HOST with creds is the edge case). Account handles `bvst`/`urso-agent` in test data are project GitHub logins, not personal data under RG-07. Test files named *.test.mjs under scripts/ may be blocked from Bash by a guard hook — use Read.
