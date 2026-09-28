---
name: changed-files-rename-blind-spot
description: scripts/lib/git.mjs changedFiles uses `git diff --name-only` without --no-renames, so a file moved out of a watched path is listed only by its destination; every CI-12 classifier (code=, app=), the mutation safety-path filter and the ratchet inherit it
metadata:
  type: project
---

`changedFiles` (scripts/lib/git.mjs lines 20 and 25 on 2026-09-26) runs `git diff --name-only`. Git's default
`diff.renames=true` makes `--name-only` print only the *destination* of a rename (verified on commit 7575fb2:
the source path appears only with `--no-renames`). Emulated with the real modules on INF-06:
- a Maestro flow moved from apps/mobile/e2e/ to a folder outside the app gives `app=false`;
- `apps/mobile/src/app/index.tsx` moved to `docs/old-index.md` gives `app=false` and `code=false`: every
  code gate on the PR prints "nothing to check".
The push-to-main full run is the loud backstop (both `code=true` and `app=true` on non-PR events).

**Why:** a wrong "no" from a classifier is a green PR over a broken change — the thing CI-12 was built to
prevent. First reported as Should fix on the INF-06 review (2026-09-26); the fix is `--no-renames` on both
diff calls, likely via /bugfix since git.mjs was outside INF-06's file list.

**How to apply:** on any PR touching affected.mjs, gate-decisions.mjs, coverage-ratchet or git.mjs, check
whether `--no-renames` has landed before repeating the finding. Related:
[[mutation-gate-skips-test-only-changes]], [[pnpm-filter-no-match-exits-zero]].
