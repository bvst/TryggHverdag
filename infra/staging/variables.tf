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
    error_message = "Expected the staging-worker check's ping URL exactly as Healthchecks.io shows it: https://hc-ping.com/ and the check's UUID in lower case, with nothing before or after. Any other spelling (the slug form, upper case, a query, a fragment, or a slash or other character at the end) is refused even when it pings, so that this URL and HEALTHCHECKS_SMS_URL can be compared: one spelling per check (D-116). Set it in GitHub: Settings → Environments → staging → the secret HEALTHCHECKS_WORKER_URL."
  }
}

variable "healthchecks_sms_url" {
  description = "The ping URL of the Healthchecks.io check staging-sms, which the worker's SMS check reports to each minute, ok or failing (LOST-07, A-32). A secret: anyone holding it can keep the check green while every SMS fails. Set by infra-staging.yml from the staging environment's secret HEALTHCHECKS_SMS_URL; never committed."
  type        = string
  sensitive   = true

  # One spelling per check: https://hc-ping.com/ and the UUID in lower case, as
  # Healthchecks.io shows it. A query, a fragment, a trailing slash or the slug
  # form still names the same check, so each is refused, and the `!=` below
  # compares checks only because each has one spelling (D-116, review loops 1
  # and 2). The worker builds /fail on the URL's path, so for the failure
  # signal this is a second guard, not the only one (LOST-07).
  validation {
    condition     = can(regex("^https://hc-ping\\.com/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", var.healthchecks_sms_url))
    error_message = "Expected the staging-sms check's ping URL exactly as Healthchecks.io shows it: https://hc-ping.com/ and the check's UUID in lower case, with nothing before or after. Any other spelling (the slug form, upper case, or a slash or other character at the end) is refused even when it pings, so that this URL and HEALTHCHECKS_WORKER_URL can be compared: one spelling per check (D-116). A query or fragment is refused too, so that the failure signal, /fail, goes straight after the UUID (LOST-07). Set it in GitHub: Settings → Environments → staging → the secret HEALTHCHECKS_SMS_URL."
  }

  # Two checks, never one: behind one address, "worker down" and "SMS failing"
  # would be one page, and an ok from either would clear the other's failing.
  validation {
    condition     = var.healthchecks_sms_url != var.healthchecks_worker_url
    error_message = "The SMS check needs a check of its own: the staging secrets HEALTHCHECKS_SMS_URL and HEALTHCHECKS_WORKER_URL hold the same ping URL. Set HEALTHCHECKS_SMS_URL to the staging-sms check's ping URL (A-32): Settings → Environments → staging."
  }
}

variable "healthchecks_canary_url" {
  description = "The ping URL of the Healthchecks.io check staging-canary, which the worker's staging canary reports to after each run, ok or failing (REL-10, A-34). A secret: anyone holding it can keep the check green while every alert is missed. Set by infra-staging.yml from the staging environment's secret HEALTHCHECKS_CANARY_URL; never committed."
  type        = string
  sensitive   = true

  # One spelling per check, as the other two: https://hc-ping.com/ and the
  # UUID in lower case, as Healthchecks.io shows it, so the `!=` below compares
  # checks, and the failure signal, /fail, goes straight after the UUID
  # (D-116).
  validation {
    condition     = can(regex("^https://hc-ping\\.com/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", var.healthchecks_canary_url))
    error_message = "Expected the staging-canary check's ping URL exactly as Healthchecks.io shows it: https://hc-ping.com/ and the check's UUID in lower case, with nothing before or after. Any other spelling (the slug form, upper case, a query, a fragment, or a slash or other character at the end) is refused even when it pings, so that it can be compared with the other two checks' URLs: one spelling per check (D-116). Create the check and save its URL as the secret HEALTHCHECKS_CANARY_URL (A-34): Settings → Environments → staging."
  }

  # Three checks, never fewer: one green ping must never keep another check
  # green, so neither the worker's nor the SMS check's URL may stand in.
  validation {
    condition     = var.healthchecks_canary_url != var.healthchecks_worker_url
    error_message = "The canary needs a check of its own: the staging secrets HEALTHCHECKS_CANARY_URL and HEALTHCHECKS_WORKER_URL hold the same ping URL. Set HEALTHCHECKS_CANARY_URL to the staging-canary check's ping URL (A-34): Settings → Environments → staging."
  }

  validation {
    condition     = var.healthchecks_canary_url != var.healthchecks_sms_url
    error_message = "The canary needs a check of its own: the staging secrets HEALTHCHECKS_CANARY_URL and HEALTHCHECKS_SMS_URL hold the same ping URL. Set HEALTHCHECKS_CANARY_URL to the staging-canary check's ping URL (A-34): Settings → Environments → staging."
  }
}
