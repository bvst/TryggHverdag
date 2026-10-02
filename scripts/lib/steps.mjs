// The gates are lists of steps. This is the part that decides which steps can
// run, runs them, and reports the result in one shape.
//
// The rule that matters: a step that cannot run yet is reported as skipped,
// with the reason and the task that will bring it — never as a step that passed.

/**
 * @typedef {object} Step
 * @property {string} name what a person would call it
 * @property {string[]} command argv to run
 * @property {string} [needsScript] a package.json script this step calls
 * @property {string} [arrivesIn] the task that adds that script
 * @property {string[]} [needsEnv] environment variables this step cannot run without
 * @property {string} [envReason] what a person should do about a missing one
 * @property {string} [needsTool] a tool that must be present and working on this machine
 * @property {string} [toolReason] why the step needs it
 */

/**
 * Decides, without running anything, which steps this repository can do today.
 *
 * @param {Step[]} steps
 * @param {Record<string, string>} scripts the package.json scripts that exist
 * @param {Record<string, string | undefined>} env
 * @param {Record<string, boolean>} available which tools this machine has working,
 *   probed by the caller so that this stays a pure decision
 */
export function planSteps(steps, scripts, env = {}, available = {}) {
  return steps.map((step) => {
    if (step.needsScript !== undefined && scripts[step.needsScript] === undefined) {
      return {
        step,
        willRun: false,
        reason: `no "${step.needsScript}" script yet${step.arrivesIn === undefined ? '' : ` — ${step.arrivesIn} adds it`}`,
      };
    }
    const missing = (step.needsEnv ?? []).filter((name) => (env[name] ?? '') === '');
    if (missing.length > 0) {
      return {
        step,
        willRun: false,
        reason: `needs ${missing.join(' and ')}${step.envReason === undefined ? '' : ` — ${step.envReason}`}`,
      };
    }
    if (step.needsTool !== undefined && available[step.needsTool] !== true) {
      return {
        step,
        willRun: false,
        reason: `needs ${step.needsTool}, which is not working on this machine${
          step.toolReason === undefined ? '' : ` — ${step.toolReason}`
        }`,
      };
    }
    return { step, willRun: true, reason: '' };
  });
}

/**
 * Runs a plan in order and stops at the first failure: a later step's output is
 * rarely useful once an earlier one is red.
 *
 * A step's own `timeout`, in milliseconds, goes to `execute` with its
 * command. A step without one passes `timeout: undefined`, which leaves the
 * runner's default (proc.mjs's `run` gives 590 s).
 *
 * @param {ReturnType<typeof planSteps>} plan
 * @param {(command: string[], options: { timeout: number | undefined }) => { ok: boolean, output: string }} execute
 */
export function runPlan(plan, execute) {
  const results = [];
  for (const planned of plan) {
    if (!planned.willRun) {
      results.push({ name: planned.step.name, status: 'skipped', detail: planned.reason });
      continue;
    }
    const result = execute(planned.step.command, { timeout: planned.step.timeout });
    results.push({
      name: planned.step.name,
      status: result.ok ? 'passed' : 'failed',
      detail: result.output,
    });
    if (!result.ok) {
      break;
    }
  }
  return results;
}

/** What the person running the gate sees at the end. */
export function summarize(results, gateName) {
  const failed = results.filter((result) => result.status === 'failed');
  const skipped = results.filter((result) => result.status === 'skipped');
  const passed = results.filter((result) => result.status === 'passed');
  const lines = [''];

  for (const result of failed) {
    lines.push(`--- ${result.name} ---`, result.detail.trim());
  }
  lines.push(
    `${gateName}: ${String(passed.length)} passed, ${String(failed.length)} failed, ${String(skipped.length)} not possible yet.`,
  );
  // Every step skipped looks exactly like every step passing, in the one number
  // a person reads. A typo in a needsScript value would otherwise turn a gate
  // into a decoration without anyone noticing.
  if (passed.length === 0 && failed.length === 0) {
    lines.push('', `${gateName}: nothing ran, so nothing was checked. That is not a pass.`);
  }
  for (const result of skipped) {
    lines.push(`  · ${result.name}: ${result.detail}`);
  }
  if (failed.length > 0) {
    lines.push(
      '',
      `Fix the failure above. ${String(results.length - passed.length - failed.length - skipped.length)} step(s) after it did not run.`,
    );
  }
  return { text: lines.join('\n') + '\n', ok: failed.length === 0 && passed.length > 0 };
}
