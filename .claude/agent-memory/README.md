# Agent memory

The reviewing agents keep notes here (`memory: project` in their frontmatter):
recurring problems they have found, and conventions they have had to repeat.

It is committed on purpose — a review that has to relearn the same lesson every
session is not much of a review. CODEOWNERS deliberately does **not** require
the owner's approval for this folder, because it changes often and carries no
rules.

Each agent's notes live in its own folder, `.claude/agent-memory/<agent>/`.
Claude Code loads that folder's `MEMORY.md` (the first 200 lines or 25 KB) and
reads the other files when a line there points to them. Nothing else in this
folder is ever loaded, so no notes go loose next to the folders (BUG-38;
`scripts/agent-memory.test.mjs` holds it).
