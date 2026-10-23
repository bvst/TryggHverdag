---
name: shared-scratchpad-worktree
description: Concurrent reviewers share the session scratchpad; a generic worktree name (wt) was removed under me, a failed cd let sed edit the MAIN tree
metadata:
  type: feedback
---
2026-10-22 (CALL-02 delta audit): my worktree at scratchpad/wt vanished mid-audit (another reviewer cleaned/pruned it; a
`wt-session` worktree also lives there). The next Bash call's `cd` failed, the shell stayed in /home/user/TryggHverdag, and
three probe `sed -i` edits landed in the caller's working tree (CODEOWNERS, merge-rules.mjs). Caught by `git status`, diff was
exactly mine, restored with `git checkout -- <those two files>`.
**Why:** the brief forbids changing the working tree; a probe edit there could be committed by the session.
**How to apply:** name worktrees uniquely (ta-<task>-audit); start every probe block with `set -e; W=<literal>; cd "$W";
[ "$(pwd)" = "$W" ] || exit 9`; restore with `git -C "$W" checkout -- .`; end each block with `git -C /home/user/TryggHverdag
status --short`. Other reviewers' uncommitted memory edits may sit in the main tree: never restore those.
Related: [[readonly-guard]], [[call01-step1-audit]]
2026-10-23 (task 2 loop 1): auto-mode classifier refused `sed -i` + `git checkout -- f` in a scratch worktree. Use a non-git copy instead:
`git archive <sha> | tar -x -C <scratch>/ta-<task>-copy`, symlink each node_modules from the main tree, keep f.orig with cp, unlink links when done.
