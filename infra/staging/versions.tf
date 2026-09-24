# Which Terraform, which provider, and where Terraform keeps its record of what
# it created.

terraform {
  # The version scripts/lib/terraform.mjs downloads and checks by hash. A test
  # holds the two to the same minor version, so CI, a cloud session and the Mac
  # never plan with different Terraforms.
  required_version = "~> 1.16.0"

  required_providers {
    clevercloud = {
      source  = "CleverCloud/clevercloud"
      version = "~> 2.2"
    }
  }

  # The state lives in a Cellar bucket (Clever Cloud's S3-compatible storage) in
  # the staging organisation, created by hand by the owner (A-20): a backend
  # cannot create the place it is stored. Credentials come from the
  # environment (AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY), never from here.
  #
  # No state locking. Cellar's support for the conditional writes that S3
  # locking needs is unverified, and the workflow that runs Terraform allows
  # one run at a time instead (`concurrency` in infra-staging.yml).
  backend "s3" {
    bucket = "trygg-hverdag-staging-tfstate"
    key    = "staging.tfstate"
    # Cellar ignores the region; the S3 client insists on having one.
    region = "us-east-1"

    endpoints = { s3 = "https://cellar-c2.services.clever-cloud.com" }

    use_path_style              = true
    skip_region_validation      = true
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_requesting_account_id  = true
  }
}
