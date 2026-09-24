# Cloud environment (A-14)

**Last updated:** 2026-09-24

The settings for the claude.ai/code environment that cloud sessions run in
(D-055). The owner applies them; this file is the record of what was asked for
and why, so a session that hits a blocked host can tell "not on the list" from
"left off on purpose".

## Network access

**Level: Custom**, with **"Also include default list of common package
managers"** checked. The default (Trusted) list already covers npm, GitHub,
Docker Hub, the Go module proxy, `releases.hashicorp.com`, `developer.apple.com`
and `developer.android.com`, so nothing below repeats it.

Paste into **Allowed domains**, one per line:

```text
www.clever.cloud
clever.cloud
registry.terraform.io
developer.hashicorp.com
docs.github.com
hono.dev
orpc.unnoq.com
orm.drizzle.team
worker.graphile.org
node.testcontainers.org
node-postgres.com
www.postgresql.org
vitest.dev
stryker-mutator.io
zod.dev
www.typescriptlang.org
typescript-eslint.io
eslint.org
prettier.io
turborepo.com
pnpm.io
docs.expo.dev
expo.dev
reactnative.dev
docs.maestro.dev
maplibre.org
docs.transistorsoft.com
firebase.google.com
docs.linkmobility.com
healthchecks.io
uptimerobot.com
kartverket.no
*.kartverket.no
www.datatilsynet.no
lovdata.no
```

| Hosts | Why | Needed from |
|-------|-----|-------------|
| `www.clever.cloud`, `clever.cloud` | Clever Cloud's documentation (hosting, D-025) | INF-07 |
| `registry.terraform.io` | `terraform init` finds the Clever Cloud provider there; also its docs | INF-07 |
| `developer.hashicorp.com` | Terraform's own documentation | INF-07 |
| `docs.github.com` | GitHub Actions and rulesets documentation | now |
| `hono.dev` … `pnpm.io` | Documentation for the server stack and toolchain already in use (D-024, D-058, D-065) | now |
| `docs.expo.dev`, `expo.dev`, `reactnative.dev`, `docs.maestro.dev`, `maplibre.org` | The app stack (D-023, D-026) | INF-06, M1, M3 |
| `docs.transistorsoft.com` | The background location SDK | M1 |
| `firebase.google.com`, `docs.linkmobility.com` | Push (FCM) and SMS documentation | M3 |
| `healthchecks.io`, `uptimerobot.com` | Monitoring documentation (REL-08) | INF-08 |
| `kartverket.no`, `*.kartverket.no` | Map tile terms, formats and rate limits (D-026). The tiles are public | M1 |
| `www.datatilsynet.no`, `lovdata.no` | Guidance and law for the DPIA (PRIV-11) | M4 |

## Left off on purpose

A session holds no production or staging credentials, and the list keeps it
that way by not reaching the places those credentials would be used.

- **`api.clever-cloud.com`** — the Clever Cloud API. `terraform plan`, `apply`
  and deploys run in GitHub Actions, with the token as a secret of the
  `staging` environment, which only `main` can read (A-21).
  A session that could reach this host is one pasted token away from changing
  or deleting staging, and later production.
- **`hc-ping.com`** — Healthchecks.io's ping endpoint. A ping from a session
  would tell the monitor the system is alive when it may not be: the one false
  signal a watchdog must never receive (REL-08).
- **The APIs of LINK Mobility and UptimeRobot** — same reasoning as Clever
  Cloud. They are reached from CI or the server, never from a session.
- **`*.cleverapps.io`** — where Clever Cloud serves apps. Staging's exact
  hostname is `trygghverdag-staging.cleverapps.io` (D-077); add that, not the
  wildcard, once staging exists, so a session can check `/v1/health`. The
  endpoint is unauthenticated and staging holds only synthetic data (D-046).
- **Full access** — every domain. Not needed, and it would make this list
  meaningless.

**One gap the list cannot close:** the default list includes `*.googleapis.com`,
which covers FCM's sending endpoint. That is harmless while sessions hold no
push credentials, which is the rule.

## GitHub is not governed by this list

GitHub traffic goes through its own proxy, which only serves repositories
attached to the session. Release downloads from other repositories can
therefore fail with a 403 even though `github.com` is on the default list.
The Clever Cloud Terraform provider is published as GitHub release assets, and
this was the worry. **Checked 2026-09-24: it does not bite.** With the list
above applied, `terraform init` in a session downloaded Terraform 1.16.4 from
`releases.hashicorp.com` (checksum verified) and provider
`CleverCloud/clevercloud` 2.2.1. If it ever does fail with a 403, the fix is
attaching `CleverCloud/terraform-provider-clevercloud` to the session
read-only, not a domain here.

**The allowlist change reached the running session.** The owner applied it
mid-session on 2026-09-24 and the next request to `www.clever.cloud` went
through, with no new session needed.

## Still to add (D-055)

- A setup script (`pnpm install`), so sessions start with dependencies on disk.
- Claude's GitHub token for opening pull requests (D-042). Today the GitHub
  tools in a session act as `@bvst` (see `docs/progress.md`), so pull requests
  are the owner's own.
