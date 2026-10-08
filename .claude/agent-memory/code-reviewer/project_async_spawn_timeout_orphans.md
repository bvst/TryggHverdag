---
name: async spawn timeout waits for orphaned grandchildren
description: spawn+timeout+once(close) returns only when grandchildren release the pipes; spawnSync returns at the timeout
type: project
---
BUG-31 review (scripts/gate-file.mjs runSteps): verified `sh -c 'sleep 8 & wait'` with timeout 1000
returns after 8 s with the async version, 1 s with spawnSync. Steps are `pnpm exec <tool>`, so the
tool is a grandchild. When replacing spawnSync by spawn, check for detached + process.kill(-pid) or
resolving on 'exit' and destroying the streams. Also stop-gate fingerprint (.claude/state/gate-passed)
reviewed: sound (HEAD, merge-base, diff HEAD --binary, untracked contents, gate name); gaps only
gitignored files, clean-filter (autocrlf) invisibility, newline in untracked path.
