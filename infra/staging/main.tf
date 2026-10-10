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

  # Staging's address, written once: the app's vhost, and where the staging
  # canary calls the public API (REL-10), so the two cannot differ.
  fqdn = "trygg-hverdag-staging.cleverapps.io"

  # The canary's credential's generation (REL-10, D-128's loop-1 amendment).
  # To rotate the credential, raise it in a pull request, then plan and apply
  # through infra-staging. The worker registers the new hash on its first
  # canary run after the restart.
  canary_credential_generation = "1"
}

# The staging canary's device credential (REL-10, D-128): 43 letters and
# digits, about 256 bits (D-091's strength). Made here, so it lives only in
# Terraform's state and the app's environment, as the database password does,
# and in no GitHub secret and no one's hands. The worker registers its hash on
# its first canary run. Rotating it is raising local.canary_credential_generation in a pull
# request: infra-staging.yml runs a fixed plan with no `-replace`, so the
# generation, its one keeper, is what replaces it (D-128's loop-1 amendment).
resource "random_password" "canary_credential" {
  length  = 43
  special = false
  keepers = { generation = local.canary_credential_generation }
}

resource "clevercloud_postgresql" "staging" {
  name   = "trygg-hverdag-staging-db"
  plan   = "dev"
  region = "par"
}

resource "clevercloud_nodejs" "staging" {
  name        = "trygg-hverdag-staging"
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

  vhosts = [{ fqdn = local.fqdn }]

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
    # own, which "on-failure" would catch too. But systemd counts an exit after
    # SIGTERM, SIGINT, SIGHUP or SIGPIPE as clean, and the worker exits 0 once
    # it has stopped for a signal, so "on-failure" would leave a worker stopped
    # by a stray signal stopped. The delay keeps a crash loop under systemd's
    # burst limit.
    CC_WORKER_RESTART       = "always"
    CC_WORKER_RESTART_DELAY = "5"

    # A deploy counts only when this answers 2xx. /v1/health answers 200 while
    # the API is up (D-065); whether the worker beats is the smoke test's job.
    CC_HEALTH_CHECK_PATH = "/v1/health"

    # Where the worker checks in with Healthchecks.io after each recorded beat,
    # so a stopped worker pages the owner (INF-08). Only the worker reads it. A
    # secret, so it comes from the staging environment and no plan shows it.
    HEALTHCHECKS_WORKER_URL = var.healthchecks_worker_url

    # Where the worker's SMS check reports each minute whether any escalation
    # SMS has waited 60 s unsent, so a failing SMS pages the owner (LOST-07).
    # Its own check, apart from the worker's. A secret, as the one above.
    HEALTHCHECKS_SMS_URL = var.healthchecks_sms_url

    # The staging canary (REL-10, D-128): every 15 minutes the worker drives a
    # test walker's journey through this app's own public address, as the
    # canary's device, and reports to a third check of its own whether the
    # alert reached the push port in time. The credential and the ping URL are
    # secrets, so no plan shows them.
    CANARY_API_URL          = "https://${local.fqdn}"
    CANARY_CREDENTIAL       = random_password.canary_credential.result
    HEALTHCHECKS_CANARY_URL = var.healthchecks_canary_url
  }
}
