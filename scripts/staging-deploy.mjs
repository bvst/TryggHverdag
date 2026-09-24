#!/usr/bin/env node
/**
 * Pushes the checked-out commit to staging. Run by deploy-staging.yml only —
 * a session is blocked from running it (HK-03), and has neither the key nor a
 * route to Clever Cloud's API anyway (docs/plan/cloud-environment.md).
 *
 * Needs CLEVER_TOKEN and CLEVER_SECRET (the staging environment's secrets,
 * A-19) and Node 24 for Clever Cloud's command-line tool.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { deployCommands, readOrganisation } from './lib/staging-deploy.mjs';
import { STAGING_APP_NAME } from './lib/staging.mjs';

const TFVARS = 'infra/staging/staging.auto.tfvars';

function fail(message) {
  process.stdout.write(`::error::${message}\n`);
  process.exit(1);
}

for (const name of ['CLEVER_TOKEN', 'CLEVER_SECRET']) {
  if ((process.env[name] ?? '') === '') {
    fail(`${name} is not set. It belongs in the "staging" environment's secrets (A-19, A-21).`);
  }
}

const organisation = existsSync(TFVARS) ? readOrganisation(readFileSync(TFVARS, 'utf8')) : null;
if (organisation === null) {
  fail(`No staging organisation in ${TFVARS}: the owner's A-18 gives its ID.`);
}

const [link, deploy] = deployCommands(organisation);
const run = (argv) => spawnSync(argv[0], argv.slice(1), { stdio: 'inherit' }).status;

if (run(link) !== 0) {
  fail(
    `Could not find the app "${STAGING_APP_NAME}" in ${organisation}. If staging has not been ` +
      'created yet, run infra-staging with "plan", then "apply" (A-22), and re-run this deploy.',
  );
}
if (run(deploy) !== 0) {
  fail("The deploy failed. The log above is Clever Cloud's; the deploy is not live.");
}
