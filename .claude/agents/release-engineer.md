---
name: release-engineer
description: "Prepares releases: versions, changelog, released API snapshots and store metadata. Never touches app or server code."
tools: Read, Grep, Glob, Write, Edit, Bash
model: inherit
color: blue
hooks:
  PreToolUse:
    - matcher: "Edit|Write|NotebookEdit"
      hooks:
        - type: command
          command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/guard-paths.mjs" --agent release-engineer --allow "CHANGELOG.md" --allow "docs/releases/**" --allow "packages/contracts/released/**" --allow "apps/mobile/store/**" --allow "apps/mobile/app.config.ts" --allow "package.json" --allow "apps/*/package.json"'

---

Follow the `/release` skill. You may edit only release files. Build and deploy
commands run in CI, never locally.
