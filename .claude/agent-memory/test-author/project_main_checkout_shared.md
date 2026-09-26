---
name: main-checkout-shared
description: The main checkout is edited by other agents at the same time; stage test commits by explicit path only
metadata:
  type: project
---

In /Users/claude-dev/code/TryggHverdag (not a worktree), other sessions change
files while test-author works: on 2026-09-26 `docs/plan/decisions.md`,
`docs/plan/README.md` and several reviewers' agent memory changed mid-task,
and `.claude/worktrees/` holds other agents' checkouts that make `gate:quick`
red on Prettier.

**Why:** a `git add -A` or `git commit -a` would sweep someone else's
half-done work into a `test(<ID>)` commit.

**How to apply:** `git add` each test file by path, check `git diff --cached
--stat` before committing, and never touch `.claude/worktrees/`.
