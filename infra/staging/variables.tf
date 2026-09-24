variable "organisation" {
  description = "The Clever Cloud organisation staging lives in: TryggHverdag Staging (A-18). An ID, not a secret."
  type        = string

  validation {
    condition     = can(regex("^orga_[0-9a-f-]{36}$", var.organisation))
    error_message = "Expected the staging organisation's ID, orga_ followed by a UUID. A personal space (user_…) is refused on purpose: staging lives in its own organisation (D-046, D-077)."
  }
}
