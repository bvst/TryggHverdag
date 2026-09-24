// Applying staging is two runs the owner starts (D-077). GitHub cannot make a
// job wait for approval in a private repository below Enterprise, so the
// approval is built from the two runs instead:
//
//   plan   — plans, shows the plan in the run's summary, and publishes a
//            fingerprint of it in the log.
//   apply  — given the plan run, re-plans, and applies only when the new plan's
//            fingerprint is the one the owner read. If anything moved in
//            between — the code, the state, the platform — the fingerprints
//            differ and it refuses.
//
// A fingerprint, not the plan file: a saved plan holds the database password in
// plain text, and anyone who can read the repository can download a run's
// artifacts. A hash of the planned changes proves "the same plan" and stores
// nothing secret.
import { createHash } from 'node:crypto';

/** The line the plan job writes and the apply job looks for. */
export const FINGERPRINT_MARKER = 'TRYGGHVERDAG_PLAN_FINGERPRINT=';

/**
 * The workflow and the job whose runs can be approved. infra-staging.yml must
 * use these names; scripts/staging-workflows.test.mjs holds it to them.
 */
export const WORKFLOW = 'infra-staging';
export const PLAN_JOB = 'plan';

/** JSON with its keys sorted, so the same data always hashes the same. */
function canonical(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * A hash of what the plan would do, from `terraform show -json <plan>`.
 * Only the changes count: when the plan was made, and which Terraform made it,
 * are not changes to anything.
 *
 * @param {{ resource_changes?: object[], output_changes?: object }} plan
 */
export function planFingerprint(plan) {
  const changes = (plan.resource_changes ?? [])
    .map((resource) => ({
      address: resource.address,
      actions: resource.change?.actions,
      before: resource.change?.before,
      after: resource.change?.after,
      afterUnknown: resource.change?.after_unknown,
    }))
    .sort((a, b) => String(a.address).localeCompare(String(b.address)));
  return createHash('sha256')
    .update(canonical({ changes, outputs: plan.output_changes ?? {} }))
    .digest('hex');
}

/** A run ID, from an ID or a run's address as GitHub shows it. */
export function parseRunId(given) {
  const text = String(given).trim();
  const match = /^(\d+)$/.exec(text) ?? /\/actions\/runs\/(\d+)(?:\/|$)/.exec(text);
  if (match?.[1] === undefined) {
    throw new Error(
      `"${text}" is not a run. Give the plan run's ID, or its address from the Actions tab.`,
    );
  }
  return match[1];
}

/**
 * The fingerprint the owner approved, from the plan run they named — after
 * checking that it is a plan run of this workflow, on main, that succeeded.
 *
 * @param {{ workflowName: string, event: string, headBranch: string, conclusion: string, jobs: { name: string, conclusion: string }[] }} run
 * @param {string} log the run's log, as `gh run view --log` prints it
 */
export function approvedFingerprint(run, log) {
  if (run.workflowName !== WORKFLOW) {
    throw new Error(`That run is from "${run.workflowName}", not ${WORKFLOW}.`);
  }
  if (run.event !== 'workflow_dispatch') {
    throw new Error(`That run was not started by hand (it came from "${run.event}").`);
  }
  if (run.headBranch !== 'main') {
    throw new Error(`That run planned "${run.headBranch}", not main.`);
  }
  if (run.conclusion !== 'success') {
    throw new Error(`That run did not succeed (${run.conclusion}), so there is no plan to apply.`);
  }
  if (!run.jobs.some((job) => job.name === PLAN_JOB && job.conclusion === 'success')) {
    throw new Error('That run did not plan anything: start one with action "plan" first.');
  }

  const found = new Set(
    [...log.matchAll(new RegExp(`${FINGERPRINT_MARKER}([0-9a-f]{64})`, 'g'))].map((m) => m[1]),
  );
  if (found.size === 0) {
    throw new Error('That plan run published no fingerprint, so there is nothing to compare with.');
  }
  if (found.size > 1) {
    throw new Error('That plan run published more than one fingerprint; refusing to pick one.');
  }
  return [...found][0];
}

/**
 * The apply run's last check: is the plan it just made the one the owner read?
 * Returns what to print when it is; throws, with what to do, when it is not.
 */
export function samePlan(current, approved, runId) {
  if (current !== approved) {
    throw new Error(
      `Staging or its configuration changed since run ${runId} was planned, so this is not the ` +
        'plan that was read. Nothing was applied. Start infra-staging with "plan" again and read the new one.',
    );
  }
  return `Same plan as the one read in run ${runId}: ${approved}`;
}
