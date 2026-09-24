// How deploy-staging.yml finds staging and pushes to it.
//
// The app is found by name inside the staging organisation, so no app ID has
// to be copied into the repository. The organisation's ID is read from the
// Terraform variables, the one place it is written down (A-18). The command-
// line tool is the pinned binary from scripts/lib/clever-tools.mjs.
import { STAGING_APP_NAME } from './staging.mjs';

/** The organisation named in infra/staging/staging.auto.tfvars, or null. */
export function readOrganisation(tfvars) {
  const match = /^\s*organisation\s*=\s*"([^"]+)"/m.exec(tfvars);
  return match?.[1] ?? null;
}

/**
 * Link the app by name in the organisation, then push the checked-out commit
 * to it, with the Clever Tools binary at `clever`.
 */
export function deployCommands(organisation, clever) {
  return [
    [clever, 'link', STAGING_APP_NAME, '--org', organisation, '--alias', 'staging'],
    // No --force: a push that is not a fast-forward means staging holds history
    // main does not, and that should stop the deploy, not overwrite it.
    // "restart" makes re-running a deploy of the same commit mean something.
    [clever, 'deploy', '--alias', 'staging', '--same-commit-policy', 'restart'],
  ];
}
