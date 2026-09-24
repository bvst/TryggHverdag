# infra

Terraform for the Clever Cloud resources (AR-12), so every infrastructure
change is reviewed like code. Written in INF-07 (staging), extended at go-live
(D-046).

| Folder | What |
|--------|------|
| `staging/` | One nano Node.js app (the API, with the worker beside it) and a DEV PostgreSQL, in the `TryggHverdag Staging` organisation (D-077) |

## Checking it

`pnpm run infra:check` — formatting, the provider lock file and `validate`,
offline and without credentials. It is part of `gate:static`, so CI, a cloud
session and the Mac all run it. The first run downloads the pinned Terraform
(`scripts/lib/terraform.mjs`, checked by hash) and the provider.

## Changing it

Applying is the owner's (D-077), through `.github/workflows/infra-staging.yml`
and never from a session:

1. Merge the change to `main`.
2. Actions → **infra-staging** → Run workflow, action **plan**. Read the plan in
   the run's summary.
3. Run workflow again, action **apply**, with the plan run's ID or address. It
   plans again and applies only if the plan is the one you read.

The state lives in the `trygghverdag-staging-tfstate` Cellar bucket (A-20), and
never in git: `.gitignore` refuses state files and saved plans, because both
can hold the database password.

`terraform apply` and `destroy` — directly or through `scripts/terraform.mjs`
— are blocked in Claude's sessions by HK-03, and sessions cannot reach Clever
Cloud's API in any case (`docs/plan/cloud-environment.md`).
