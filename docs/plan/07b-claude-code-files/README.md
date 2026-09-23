# 7b · Claude Code files — draft v0

**Status:** Draft v0 (D-044) · **Last updated:** 2026-09-20

> **This is a dated record of v0, not the current configuration. Do not follow
> it as a template.** The drafts here were installed with changes, recorded as
> **D-059 — Claude Code configuration v1, as installed**, and the live
> `.claude/`, `CLAUDE.md` and `.github/CODEOWNERS` have moved on since. Where
> the two differ, **the live files are authoritative** and these are the
> history of where they started.
>
> **Most of these files already differ from live** — briefs, hooks, settings,
> `CLAUDE.md` and `.github/CODEOWNERS` among them — because D-059 installed
> them with changes and D-067, D-069, D-070, D-071 and D-074 have moved the
> live ones since. **That drift is the point, not a defect**: v0 is meant to
> stay v0. Nothing should sync these to live, and a test asserting they match
> would erase the v0/v1 distinction this repository keeps on purpose.
>
> No count is given here on purpose. The first version of this note said
> "ten", having quietly compared only `*.md` files and so missing the hooks,
> `settings.json` and `CODEOWNERS` — in the very sentence that cites D-071,
> the decision that changed `CODEOWNERS`. A reviewer counted 20, a recount
> against the working tree gave 21, and the difference is which tree was
> measured. A hand-maintained tally in a static note is wrong the moment
> anything moves. Ask the repository instead:
>
> ```sh
> find docs/plan/07b-claude-code-files -type f | while read -r f; do
>   rel="${f#docs/plan/07b-claude-code-files/}"
>   [ "$rel" = "README.md" ] && continue   # this file; not one that is copied out
>   [ -f "$rel" ] && ! diff -q "$f" "$rel" >/dev/null && echo "$rel"
> done
> ```
>
> The `continue` is load-bearing. Without it the loop compares *this* README
> against the project's top-level `README.md` — unrelated files that share a
> name — and reports a difference that means nothing.

These are the first versions of the Claude Code configuration from
`07-claude-code-setup.md`. They are copied into the repository root when it is
created (Section 10's first milestone), then verified as described below.

```
CLAUDE.md                     build-phase version (replaces the planning one)
.github/CODEOWNERS            paths that need the owner's approval (D-042)
.claude/settings.json         permissions + hook wiring
.claude/rules/                5 path-scoped rule files
.claude/agents/               11 agents
.claude/skills/               5 workflows + 7 reference skills
.claude/hooks/                7 hook scripts + shared lib (Node 22+, no dependencies)
```

## How the pieces enforce the gates

| Gate | Enforced by |
|------|-------------|
| Tests first; implementers can't touch tests (RG-02, RG-03) | `implementer` frontmatter hooks → `guard-paths.mjs --deny` and `guard-bash.mjs --deny-write-glob` |
| Test authors can't touch production code | `test-author` frontmatter hooks |
| Reviewers are read-only | `guard-bash.mjs --readonly` in each reviewer, plus no Edit or Write tools |
| No pushing to `main`, force pushes, `--no-verify`, local deploys, admin merges | `settings.json` deny rules **and** `guard-bash.mjs --global` (two independent layers) |
| No secrets, real phone numbers or location logging (PRIV-07, RG-07) | `scan-sensitive.mjs` |
| Checks after every edit | `post-edit.mjs` → `pnpm gate:file` |
| Test weakening flagged immediately | `test-weakening.mjs` (CI repeats it on the whole PR) |
| Can't finish while the gate fails | `stop-gate.mjs` on Stop and on `implementer`'s SubagentStop |
| Owner approval for safety paths and the gates themselves | `CODEOWNERS` + GitHub rules (D-042) |

**Hooks are thin by design.** The real checks live in repository scripts
(`gate:file`, `gate:static`, `gate:quick`, `gate:full`, `req:coverage`,
`api:diff`, `mutation`), so CI runs exactly the same logic as the local
session.

## Verification at repository setup (all automated, D-035)
1. Accept the workspace trust prompt once, so project agents' hooks run.
2. `claude plugin validate .claude/agents` checks the agents' frontmatter.
3. Unit tests for every hook script, run in CI (for example: `guard-paths`
   blocks `apps/server/src/x.test.ts` for `implementer`; `guard-bash --global`
   blocks `git push origin main`).
4. A scripted Claude Code session in CI (headless) tries each forbidden action
   and asserts it is blocked.
5. Verify the permission rule path syntax (`./` prefixes) against the current
   Claude Code documentation.

## Known limits (stated honestly)
- **Shell loophole:** `guard-bash --deny-write-glob` is a heuristic. An agent
  could still change a test file through an unusual command. The CI test-change
  detector and `test-auditor` are the backstop, and CODEOWNERS stops unreviewed
  gate changes.
- **Stop-gate loops:** if the gate still fails after Claude was asked to
  continue once, the hook records `.claude/state/gate-failed` instead of looping
  forever. `session-start` and `/status` show it, and CI blocks the merge.
- **Red phase:** `/feature` writes `.claude/state/phase` while tests are meant to
  fail. A stale marker is shown at session start. Add `.claude/state/` to
  `.gitignore`.

## Still to write at repository setup
The `gate:*`, `req:coverage`, `api:diff` and `mutation` scripts; the CI
workflows (Section 8); hook unit tests; and replacing `@OWNER` in CODEOWNERS.
