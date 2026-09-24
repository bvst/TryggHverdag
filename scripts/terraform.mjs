#!/usr/bin/env node
/**
 * Runs the pinned Terraform (scripts/lib/terraform.mjs) with the arguments
 * given, so infra-staging.yml, a cloud session and the Mac use one version.
 *
 * Usage: node scripts/terraform.mjs -chdir=infra/staging plan
 *
 * A session may validate and plan with it, but apply and destroy are blocked
 * there by HK-03: applying staging is the owner's (D-077).
 */
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { TERRAFORM_ENV, ensureTerraform } from './lib/terraform.mjs';

const terraform = await ensureTerraform();
const result = spawnSync(terraform, process.argv.slice(2), {
  stdio: 'inherit',
  env: { ...process.env, ...TERRAFORM_ENV },
});
if (result.error !== undefined) {
  // Could not start at all: say why, rather than exiting 1 with nothing printed.
  process.stderr.write(`terraform: could not run ${terraform}: ${result.error.message}\n`);
}
process.exitCode = result.status ?? 1;
