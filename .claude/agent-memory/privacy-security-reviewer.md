# privacy-security-reviewer — notes

Recurring problems and conventions, so the same lesson is not relearned every
session. Newest first.

## Path filters that route reviewers (`.github/workflows/ai-review.yml`)
A `dorny/paths-filter` list decides whether this reviewer runs at all. When a
path is missing from the `privacy` filter the job still reports **green** — a
review that never happened, wearing the badge of a review that found nothing
(the D-045 failure mode). Always check the filter against the planned layout in
`docs/plan/05-architecture.md`, not against the paths that exist today:

- server modules are `identity, groups, journeys, alerts, notifications, maps,
  privacy` — PRIV-01/-03/-04 live in `journeys`, push payloads in
  `notifications`, minors and invitations in `groups`, third-party tile calls in
  `maps`;
- `apps/server/src/worker.ts` runs retention (PRIV-04);
- `apps/mobile/src/safety-core/**` is background location (PRIV-01);
- `packages/contracts/**` defines what personal data crosses the wire;
- `.github/**` and `scripts/**` are where secrets and tokens are handled.

INF-04 (f757ef0) shipped a `privacy` filter covering only `identity`, `privacy`,
`adapters`, `**/logging/**`, `**/package.json`, `pnpm-lock.yaml` and `infra/**`.
Re-check this list on every workflow change.

## Licences of GitHub Actions are not gated
`pnpm run licenses:check` reads `pnpm licenses list` — npm dependencies only.
Actions added in `.github/workflows/**` pass no licence gate at all. Check each
new action's LICENSE by hand.

Known so far: `actions/checkout`, `actions/setup-node`, `pnpm/action-setup`,
`dorny/paths-filter`, `anthropics/claude-code-action` are MIT.
**`gitleaks/gitleaks-action` is NOT open source** — it is a Gitleaks LLC EULA
(free for personal-account repos, paid licence key required the moment the repo
belongs to an organisation). `ALLOWED_LICENCES` in `scripts/lib/licenses.mjs`
does not contain it. The MIT-licensed `gitleaks` CLI is the alternative.

## Action pins
Verify pinned SHAs rather than trusting the trailing `# vX.Y.Z` comment:
`git ls-remote --tags https://github.com/<owner>/<repo>` works here; the GitHub
REST API is blocked by the agent proxy. All six pins in INF-04 were correct.
Note that `pnpm/action-setup` and `anthropics/claude-code-action` were pinned to
the **annotated tag object** SHA, not the peeled commit SHA — immutable either
way, so not a security problem, but the peeled commit is the convention
Dependabot expects.

## Secrets in CI — what is already done well (do not re-flag)
- `on: pull_request` rather than `pull_request_target`, so fork PRs get no
  secrets;
- secrets passed through `env:` on the single step that needs them, never
  interpolated into a `run:` body, and never on the `pnpm install` step;
- `github.base_ref` used in `run:` bodies, never `github.head_ref`;
- `repoSlug` in `scripts/gate-integrity.mjs` constrains owner/repo to
  `[\w.-]+`, so the token cannot be redirected off `api.github.com`.

## Secrets in CI — the gap to keep checking
`.github/**` needs owner approval via CODEOWNERS, but `/scripts/` and
`/package.json` do not — and those are what the jobs holding `RULES_READ_TOKEN`
actually execute on a `pull_request` event. Any new CI secret inherits this.
Also: every new secret must be added to the inventory in
`docs/plan/08-cicd-releases.md`, or the yearly rotation policy never reaches it.

## Cross-border flow worth remembering (PRIV-05, D-016)
`ai-review.yml` sends the whole diff to Anthropic, and posts findings as a
GitHub pull request comment. Both are outside the EEA and neither is covered by
PRIV-04 retention. This is fine only because test data is synthetic (RG-07) —
so RG-07 is load-bearing for PRIV-05, not just for tidiness.
