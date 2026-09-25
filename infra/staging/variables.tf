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

  validation {
    condition     = can(regex("^https://hc-ping\\.com/", var.healthchecks_worker_url))
    error_message = "Expected the check's ping URL from Healthchecks.io, starting https://hc-ping.com/ and followed by the check's UUID. Anything else would ping nothing, and a check that is never pinged never pages (INF-08). Set it in GitHub: Settings → Environments → staging → the secret HEALTHCHECKS_WORKER_URL."
  }
}
