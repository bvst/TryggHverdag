# 8b · CI files — draft v0

**Status:** Draft v0 (D-049) · **Last updated:** 2026-09-20

Copied into the repository at setup, together with `07b-claude-code-files/`.
`release-SKILL.md` replaces `07b-claude-code-files/.claude/skills/release/SKILL.md`.

| File | Purpose |
|------|---------|
| `.github/workflows/release.yml` | Owner-approved release PR → gates → production (from go-live) + app builds and store submission (D-047) |
| `.github/workflows/nightly.yml` | Full mutation run, canary report, weekly iOS simulator tests on EAS |

**`ci.yml`, `ai-review.yml` and `dependabot.yml` are no longer here.** INF-04
installed them, with the changes recorded in D-060, and a draft sitting beside
the installed file is a second version for someone to read by mistake. The
same went for `daily-status.yml` and the owner-question issue template when
INF-09 installed them (D-076), and for `deploy-staging.yml` when INF-07
installed it (D-077). The remaining files are still drafts, waiting
for the task that installs them.

## To verify at setup (automated where possible, D-035)
- The input names of the Claude Code GitHub Action (`claude_code_oauth_token`,
  `prompt`), and that the OAuth token works with the Max plan; if not, use an
  API key (D-045). **Done**: `ai-review.yml` has run on them since #8, and
  `daily-status.yml` uses the same inputs plus `github_token` (D-076).
- The `clever-tools` deploy syntax and aliases; that a free DEV PostgreSQL
  works with the connection pool settings (maximum 5 connections). **Moved to
  INF-07**: D-077 records what was checked and what stays unverified until
  the first deploy.
- The repository scripts named in the workflows: `gate:*`, `test:*`,
  `api:diff`, `req:coverage`, `tests:changes`, `coverage:ratchet`,
  `mutation`, `e2e:*`, `db:migrate`, `smoke`, `canary:*`, `release:gates`,
  `licenses:check`, `test:hooks`.
- Mark every job as a **required status check** in the merge rules, and pin
  action versions to commit SHAs. **Done for the installed workflows**, and
  `pnpm run gate:integrity` now enforces both (CI-01).
- The note above said `CLAUDE_BOT_TOKEN` would read the merge rules. It cannot:
  Claude's account has write access and not admin, on purpose (A-06). See
  `../merge-rules.md` and D-060.
