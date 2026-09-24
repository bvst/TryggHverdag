# Staging (D-046, D-077): one nano instance running the API and the worker
# together, and Clever Cloud's free DEV PostgreSQL. Synthetic data only.
#
# Terraform creates and configures; it does not deploy. deploy-staging.yml
# pushes the code on every merge to main, so there is no `deployment` block.

provider "clevercloud" {
  organisation = var.organisation
}

locals {
  # How Node runs the server: TypeScript, types stripped at start-up, no build
  # step. The flag is on by default from Node 22.18; naming it keeps an older
  # Node 22 from failing on the first `import type`.
  # apps/server/src/bin/bin.test.ts runs these same files with the same flag.
  node = "node --experimental-strip-types"
}

resource "clevercloud_postgresql" "staging" {
  name   = "trygghverdag-staging-db"
  plan   = "dev"
  region = "par"
}

resource "clevercloud_nodejs" "staging" {
  name        = "trygghverdag-staging"
  description = "TryggHverdag staging: API and worker, synthetic data only"
  region      = "par"

  # One instance, never more. The worker runs beside the API on the same
  # instance, and two instances would mean two workers; the DEV database allows
  # five connections, which one instance already budgets for (POOL_SIZE).
  min_instance_count = 1
  max_instance_count = 1
  smallest_flavor    = "nano"
  biggest_flavor     = "nano"

  # Linking the database is what puts POSTGRESQL_ADDON_URI into the app's
  # environment, which apps/server/src/config.ts reads.
  dependencies = [clevercloud_postgresql.staging.id]

  package_manager = "pnpm"
  redirect_https  = true
  start_script    = "${local.node} apps/server/src/bin/api.ts"

  vhosts = [{ fqdn = "trygghverdag-staging.cleverapps.io" }]

  hooks {
    # Before every start. A failure stops the deploy: new code never starts
    # against an old schema.
    pre_run = "${local.node} apps/server/src/bin/migrate.ts"
  }

  environment = {
    NODE_ENV = "production"

    # The worker, as a second process on the same instance.
    CC_WORKER_COMMAND = "${local.node} apps/server/src/bin/worker.ts"
    # Restart it whatever way it ended. It exits with 1 when it stops on its
    # own, which "on-failure" would catch too; "always" also covers an exit
    # nobody foresaw. The delay keeps a crash loop under systemd's burst limit.
    CC_WORKER_RESTART       = "always"
    CC_WORKER_RESTART_DELAY = "5"

    # A deploy counts only when this answers 2xx. /v1/health answers 200 while
    # the API is up (D-065); whether the worker beats is the smoke test's job.
    CC_HEALTH_CHECK_PATH = "/v1/health"
  }
}
