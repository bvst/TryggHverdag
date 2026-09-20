# 8b · CI files — draft v0

**Status:** Draft v0 (D-049) · **Last updated:** 2026-09-20

Copied into the repository at setup, together with `07b-claude-code-files/`.
`release-SKILL.md` replaces `07b-claude-code-files/.claude/skills/release/SKILL.md`.

| File | Purpose |
|------|---------|
| `.github/workflows/ci.yml` | Required checks CI-01 to CI-10 on every pull request |
| `.github/workflows/ai-review.yml` | CI-11: one required check per AI reviewer; blocking vs advisory (D-043) |
| `.github/workflows/deploy-staging.yml` | Merge to `main` → staging (D-046) |
| `.github/workflows/release.yml` | Owner-approved release PR → gates → production (from go-live) + app builds and store submission (D-047) |
| `.github/workflows/nightly.yml` | Full mutation run, canary report, weekly iOS simulator tests on EAS |
| `.github/dependabot.yml` | Weekly dependency updates through the same gates |
| `.github/workflows/daily-status.yml` | Daily status report as a comment on the pinned issue (D-050) |
| `.github/ISSUE_TEMPLATE/owner-question.md` | One question per issue, with a recommendation (D-051) |

## To verify at setup (automated where possible, D-035)
- The input names of the Claude Code GitHub Action (`claude_code_oauth_token`,
  `prompt`), and that the OAuth token works with the Max plan; if not, use an
  API key (D-045).
- The `clever-tools` deploy syntax and aliases; that a free DEV PostgreSQL
  works with the connection pool settings (maximum 5 connections).
- The repository scripts named in the workflows: `gate:*`, `test:*`,
  `api:diff`, `req:coverage`, `tests:changes`, `coverage:ratchet`,
  `mutation`, `e2e:*`, `db:migrate`, `smoke`, `canary:*`, `release:gates`,
  `licenses:check`, `test:hooks`.
- Mark every job as a **required status check** in the merge rules, and pin
  action versions to commit SHAs.
