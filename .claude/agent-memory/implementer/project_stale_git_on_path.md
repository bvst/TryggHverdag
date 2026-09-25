---
name: stale-git-on-path
description: On the owner's Mac, /usr/local/bin/git is 2.23 (no `git init -b`) and comes first on the PATH the stop hook inherits, so hook/affected tests fail there
metadata:
  type: project
---

On the Mac (`claude-dev`), `/usr/local/bin/git` is git 2.23.0 and comes before `/usr/bin/git` (2.50) on Claude Code's default PATH. `git init -b` needs 2.28 or newer. The stop hook runs `gate:quick` with that PATH, so `.claude/hooks/*.test.mjs` and `scripts/lib/affected.test.mjs` fail with "unknown switch `b'", whatever the change is. The same test fails on a clean `main` checkout too (checked 2026-09-25, BUG-4).

**Why:** this is the same kind of problem as the old Node 20 on the hook PATH that BUG-4's build log describes. **Update, 2026-09-25:** `claude-dev`'s pnpm shim (`~/.local/bin/pnpm`) now puts both `/usr/local/opt/node@22/bin` and `/usr/local/opt/git/bin` first, so hooks get git 2.55 even from a session started before `~/.zshrc` changed. If this recurs, check that shim first.

**How to apply:** if the stop gate shows `git init -q -b main` failures, show that the gate passes with `/usr/local/opt/git/bin` first on PATH, and report the machine problem to the owner. Don't change tests or code to work around it. The owner can fix it by removing or upgrading `/usr/local/bin/git`, or by having the shim put `/usr/local/opt/git/bin` first.
