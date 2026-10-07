variable "organisation" {
  description = "The Clever Cloud organisation staging lives in: TryggHverdag Staging (A-18). An ID, not a secret."
  type        = string

  validation {
    condition     = can(regex("^orga_[0-9a-f-]{36}$", var.organisation))
    error_message = "Expected the staging organisation's ID, orga_ followed by a UUID. A personal space (user_…) is refused on purpose: staging lives in its own organisation (D-046, D-077)."
  }
}

variable "healthchecks_worker_url" {
  description = "The ping URL of the Healthchecks.io check that watches the staging worker (INF-08). A secret: anyone holding it can keep the check green while the worker is dead. Set by infra-staging.yml from the staging environment's secret HEALTHCHECKS_WORKER_URL; never committed."
  type        = string
  sensitive   = true

  # The check's address and nothing after it: no query, no fragment, no
  # trailing slash, read by the same rule as the SMS check's URL (LOST-07).
  # And one spelling per check: https://hc-ping.com/ and the UUID in lower
  # case, as Healthchecks.io shows it. Healthchecks.io also reads /<uuid>/ and
  # the slug form as the same check, so the `!=` on healthchecks_sms_url
  # compares checks only when each has one spelling (D-116, review loop 2).
  validation {
    condition     = can(regex("^https://hc-ping\\.com/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", var.healthchecks_worker_url))
    error_message = "Expected the check's ping URL from Healthchecks.io: https://hc-ping.com/ followed by the check's UUID in lower case, as Healthchecks.io shows it, and nothing after it (no query, fragment or trailing slash). Anything else would ping nothing, and a check that is never pinged never pages (INF-08). Set it in GitHub: Settings → Environments → staging → the secret HEALTHCHECKS_WORKER_URL."
  }
}

variable "healthchecks_sms_url" {
  description = "The ping URL of the Healthchecks.io check staging-sms, which the worker's SMS check reports to each minute, ok or failing (LOST-07, A-32). A secret: anyone holding it can keep the check green while every SMS fails. Set by infra-staging.yml from the staging environment's secret HEALTHCHECKS_SMS_URL; never committed."
  type        = string
  sensitive   = true

  # The check's address and nothing after it: the failure signal is this URL
  # with /fail on its path, which a query, a fragment or a trailing slash would
  # misplace, so a failing SMS would page nobody (LOST-07). And one spelling
  # per check: https://hc-ping.com/ and the UUID in lower case, as
  # Healthchecks.io shows it. Healthchecks.io also reads /<uuid>/ and the slug
  # form as the same check, so the `!=` below compares checks only when each
  # has one spelling (D-116, review loop 2).
  validation {
    condition     = can(regex("^https://hc-ping\\.com/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", var.healthchecks_sms_url))
    error_message = "Expected the staging-sms check's ping URL from Healthchecks.io: https://hc-ping.com/ followed by the check's UUID in lower case, as Healthchecks.io shows it, and nothing after it (no query, fragment or trailing slash). Anything else would report to nothing, and a failing SMS would page nobody (LOST-07). Set it in GitHub: Settings → Environments → staging → the secret HEALTHCHECKS_SMS_URL."
  }

  # Two checks, never one: behind one address, "worker down" and "SMS failing"
  # would be one page, and an ok from either would clear the other's failing.
  validation {
    condition     = var.healthchecks_sms_url != var.healthchecks_worker_url
    error_message = "The SMS check needs a check of its own: the staging secrets HEALTHCHECKS_SMS_URL and HEALTHCHECKS_WORKER_URL hold the same ping URL. Set HEALTHCHECKS_SMS_URL to the staging-sms check's ping URL (A-32): Settings → Environments → staging."
  }
}
