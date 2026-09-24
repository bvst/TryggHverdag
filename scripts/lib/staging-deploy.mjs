// How deploy-staging.yml finds staging and pushes to it.
//
// The app is found by name inside the staging organisation, so no app ID has
// to be copied into the repository. The organisation's ID is read from the
// Terraform variables, the one place it is written down (A-18).
import { STAGING_APP_NAME } from './staging.mjs';

/**
 * Clever Cloud's command-line tool, by exact version: `latest` would be
 * whatever was published this morning, in a job that holds the staging key.
 * It needs Node 24, which is why deploy-staging.yml runs on 24 while the
 * repository is on 22.
 */
export const CLEVER_TOOLS = ['npx', '--yes', 'clever-tools@5.0.2'];

/** The organisation named in infra/staging/staging.auto.tfvars, or null. */
export function readOrganisation(tfvars) {
  const match = /^\s*organisation\s*=\s*"([^"]+)"/m.exec(tfvars);
  return match?.[1] ?? null;
}

/** Link the app by name in the organisation, then push the checked-out commit to it. */
export function deployCommands(organisation) {
  return [
    [...CLEVER_TOOLS, 'link', STAGING_APP_NAME, '--org', organisation, '--alias', 'staging'],
    // No --force: a push that is not a fast-forward means staging holds history
    // main does not, and that should stop the deploy, not overwrite it.
    // "restart" makes re-running a deploy of the same commit mean something.
    [...CLEVER_TOOLS, 'deploy', '--alias', 'staging', '--same-commit-policy', 'restart'],
  ];
}
