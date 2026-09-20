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
 */

/**
 * Decides, without running anything, which steps this repository can do today.
 *
 * @param {Step[]} steps
 * @param {Record<string, string>} scripts the package.json scripts that exist
 */
export function planSteps(steps, scripts) {
  return steps.map((step) => {
    if (step.needsScript !== undefined && scripts[step.needsScript] === undefined) {
      return {
        step,
        willRun: false,
        reason: `no "${step.needsScript}" script yet${step.arrivesIn === undefined ? '' : ` — ${step.arrivesIn} adds it`}`,
      };
    }
    return { step, willRun: true, reason: '' };
  });
}

/**
 * Runs a plan in order and stops at the first failure: a later step's output is
 * rarely useful once an earlier one is red.
 *
 * @param {ReturnType<typeof planSteps>} plan
 * @param {(command: string[]) => { ok: boolean, output: string }} execute
 */
export function runPlan(plan, execute) {
  const results = [];
  for (const planned of plan) {
    if (!planned.willRun) {
      results.push({ name: planned.step.name, status: 'skipped', detail: planned.reason });
      continue;
    }
    const result = execute(planned.step.command);
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
  for (const result of skipped) {
    lines.push(`  · ${result.name}: ${result.detail}`);
  }
  if (failed.length > 0) {
    lines.push(
      '',
      `Fix the failure above. ${String(results.length - passed.length - failed.length - skipped.length)} step(s) after it did not run.`,
    );
  }
  return { text: lines.join('\n') + '\n', ok: failed.length === 0 };
}
