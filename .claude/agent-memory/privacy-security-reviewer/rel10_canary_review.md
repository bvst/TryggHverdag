---
name: rel10-canary-review
description: REL-10 staging canary review (2a56f8a, PASS) — recipes for Terraform lock and sensitivity proofs, the HTTP-client and log probes, and the recurring miss of the docs a spec's file table promises
metadata:
  type: project
---

REL-10 (2026-10-10, 2a56f8a) PASS. Saved by the main session: the brief said not to edit files.

- Recipes:
  - `terraform providers lock` for the three platforms in a scratch dir, then diff the lock block (it says
    "signed by HashiCorp");
  - `providers schema -json` after `init -plugin-dir=infra/staging/.terraform/providers` with the s3 backend
    removed: random_password.result and bcrypt_hash and clevercloud_nodejs.environment are sensitive;
  - a terraform_data stand-in shows its inputs in clear through its own `output` attribute, so use the
    schema, not terraform_data, for masking proofs;
  - a client probe against local http servers plus hand-built fetch functions;
  - the dependency-cruiser copy recipe is still 5 MB (git ls-files root files + tar of apps/server and
    packages + symlinked node_modules).
- A random 43-character credential made from 32 bytes of base64 with + and / stripped came out short: use
  64 bytes.
- Recurring miss (4th time): the docs the spec's file table promises (08 inventory, monitoring-setup, README
  Open for M4) did not change. Diff the spec's file table against git diff --stat first.
- Open for M5's production canary: config.ts (unowned) enforces "https only, exact origin"; on staging
  Terraform (owned) fixes the value, so loosening config.ts alone cannot redirect the credential.
