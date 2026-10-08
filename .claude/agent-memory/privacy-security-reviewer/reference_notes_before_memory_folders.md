---
name: notes-before-memory-folders
description: The notes privacy-security-reviewer kept in .claude/agent-memory/privacy-security-reviewer.md, which Claude Code never loaded; moved here unchanged on 2026-10-08 (BUG-38). Recurring patterns and how to verify things in this repository; check a note against the current code before relying on it
metadata:
  type: reference
---

# privacy-security-reviewer — notes

Recurring problems and conventions, so the same lesson is not relearned every
session. Newest first.

## INF-08 (Healthchecks.io check-in, 2026-09-25) — secrets in outbound URLs
- **Probe the adapter, do not read it.** A scratch `.mts` run with
  `node --experimental-strip-types --no-warnings` that imports the adapter and
  `redact.ts`, a secret-looking UUID, and these failure modes: unparseable URL,
  `user:pass@` URL, refused, DNS, TLS to a plain-HTTP port, 404, redirect, reset,
  timeout, `ftp:`, bad port. Check `describeFailure`, `.stack`,
  `inspect(e,{showHidden:true})`, `JSON.stringify`, and `cause`. The INF-08 adapter
  (a new Error from fixed words plus a `^[A-Z][A-Z0-9_]*$` cause code) passed all of them.
- **Node's fetch follows redirects by default, including https→http.** A secret
  in a URL path is "never sent in clear" only for the first hop unless the call
  sets `redirect: 'error'`. Worth a note on every outbound call that carries a
  secret in its URL.
- **Terraform 1.16.4 with a `sensitive` variable** (verified with a scratch config and
  `terraform_data`): validation errors, `plan` and `show` print `(sensitive value)`.
  `show -json` holds it in clear, so check that JSON is only hashed and never uploaded.
  **An unset GitHub secret becomes `TF_VAR_x=""`**, which Terraform reports as
  "Invalid value for variable", not "No value for required variable".
- **`gh` is not installed in the session**, so the settings of the `staging`
  environment (the main-only branch policy) cannot be verified. Say so.
- **New npm dependencies:** `npm view <pkg>@<v> dist.integrity` works through the
  proxy. Compare it with the lockfile's `integrity`, and use `time.modified` to see
  whether the package is maintained. test-kit's `dependencies` are dev-only
  transitively: test-kit is only a devDependency of apps/server, and dependency-cruiser's
  `test-kit-belongs-in-tests` rule keeps production code from importing it.
- `reports/` (the Stryker incremental JSON, which holds test output) is gitignored.
- The secrets inventory lists "Healthchecks check-in URLs" generically. New
  Healthchecks secrets need their name and store listed, as CLEVER_*/CELLAR_* are.

## INF-07 (staging on Clever Cloud) — what to re-check on every deploy/infra change
- **Redaction regexes** (`apps/server/src/process.ts` `redactCredentials`): probe them, do
  not read them. As shipped they leaked on: `@` in a URL password (only the part
  before the first `@` was hidden), a scheme preceded by `_`/digit (`\b`), `PGPASSWORD=`
  / `POSTGRESQL_ADDON_PASSWORD=` / `DB_PASSWORD=` (`\bpassword`), quoted values with
  escapes or spaces, and the colon forms `password: '…'` / `"password":"…"` — which is
  exactly what `util.inspect` of a non-Error thrown value produces. A version that
  passed all of those plus the no-credential cases:
  `/([a-z][a-z0-9+.-]*:\/\/[^\s:/@]*:)[^\s/]*@/gi` and
  `/(password['"]?\s*[:=]\s*)('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|[^\s,;}&]+)/gi`.
  Quick probe: `node --experimental-strip-types` on a scratch .mts importing process.ts
  (Vitest swallows console output).
- **Output channels that bypass `redactCredentials`** (so "every message goes through
  it" is false): graphile-worker's default logger (`Failed task … with error '<msg>'` +
  stack; it also installs its own pool error handlers when none exist), Hono's default
  `onError` (`console.error(err)`), `@hono/node-server` `handleResponseError`
  (`console.error` and it echoes `Error: <message>` to the client), Node's
  uncaught-exception printer. **`DrizzleQueryError`'s message contains the query
  params verbatim** — the PRIV-07 hazard for M2, when params are positions and phone
  numbers. oRPC 1.15 itself logs nothing.
- **Clever Cloud's CLI deploy command streams deploy and start-up logs into the GitHub
  Actions log** (US, readable by anyone with repo read, not GitHub-masked since the DB
  URL is not a GitHub secret). Redaction is what stands between a crash message and
  that log. Relevant again for production at go-live (PRIV-05).
- **HK-03 is text matching.** Allowed as shipped: `gh -R o/r workflow run …`,
  `gh --repo …`, `gh run rerun <id>`, `gh api -X POST …/actions/runs/<id>/rerun`, and
  `terraform -chdir=… apply` (flags between the words). Test by piping
  `{"tool_input":{"command":…}}` into a copy of the hook, building the command string
  by concatenation — the live hook blocks your own Bash call otherwise. HK-03 also
  blocks any Bash command whose *text* contains the staging deploy script's path or
  the CLI's two-word deploy command — even a heredoc writing this memory file. Read
  that script with the Read tool, and word such notes around those strings.
- **The `staging` environment's "main only" branch policy is the only barrier** between
  a pushed branch and CLEVER_*/CELLAR_* (a push-triggered workflow on any branch runs
  immediately, CODEOWNERS only gates merging). gate:integrity (5 checks) does not look
  at environments or at whether those names exist as *repository* secrets.
- **`npx pkg@x.y.z` pins only the top package.** clever-tools@5.0.2 resolves 180
  packages fresh on every deploy (`_hasShrinkwrap: false`), invisible to pnpm audit,
  Dependabot and licenses:check. Resolve it with `npm install --package-lock-only
  --ignore-scripts` in scratch to count and see licences.
- **Terraform ≥1.6 is BUSL-1.1 (IBM)**, not on ALLOWED_LICENCES and not gated (not npm).
  Own-infrastructure use is inside the Additional Use Grant. CleverCloud provider is
  Apache-2.0. Provider schema (`terraform providers schema -json` with
  `-plugin-dir=infra/staging/.terraform/providers`): `clevercloud_postgresql.password`,
  `.uri` and `clevercloud_nodejs.environment` are sensitive, so `terraform show`
  (non-JSON) masks them. Pinned Terraform hashes matched HashiCorp's SHA256SUMS
  (curl works to releases.hashicorp.com).
- **Shell gotcha in workflows:** `echo "x=$(cmd)" >> "$GITHUB_OUTPUT"` hides a failing
  `cmd` even under `bash -e -o pipefail`; assign first (`x=$(cmd)`), then echo.
- **Secrets inventory** (`docs/plan/08-cicd-releases.md`): check new secret *names* and
  their store (environment vs repository), not just the service. Cellar keys were missing.

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
**Since then this reviewer runs with `applies: always`** (checked 2026-09-24), so the
filter no longer gates it; only `safety` is filtered. Re-check on workflow changes.

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
**Closed by 2026-09-24:** `/scripts/`, `/package.json` and `/infra/` are now in
CODEOWNERS. Historical note — `.github/**` needed owner approval, but `/scripts/` and
`/package.json` did not — and those are what the jobs holding `RULES_READ_TOKEN`
actually execute on a `pull_request` event. Any new CI secret inherits this.
Also: every new secret must be added to the inventory in
`docs/plan/08-cicd-releases.md`, or the yearly rotation policy never reaches it.

## Cross-border flow worth remembering (PRIV-05, D-016)
`ai-review.yml` sends the whole diff to Anthropic, and posts findings as a
GitHub pull request comment. Both are outside the EEA and neither is covered by
PRIV-04 retention. This is fine only because test data is synthetic (RG-07) —
so RG-07 is load-bearing for PRIV-05, not just for tidiness.
