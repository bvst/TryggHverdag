// SPIKE-01: runs a Maestro flow on the iOS simulator, with its analytics and
// update check off (D-081 item 6). The flows only act: they tap, and wait for
// what is on screen. They never decide a verdict.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { env } from 'node:process';

import { REPOSITORY, SPIKE } from './run.mjs';

const MAESTRO = join(REPOSITORY, 'node_modules/.cache/maestro/2.10.0/maestro/bin/maestro');
const JAVA_HOME = join(homedir(), 'jdks/jdk-17.0.20.1+1/Contents/Home');

/** A flow taps and waits for the screen; none should take this long (the code review, 2026-10-01). */
const FLOW_TIMEOUT_MS = 3 * 60_000;

/**
 * Runs `flow` (a file in drivers/maestro) against the device, with `vars` as
 * Maestro's `-e` variables. Asynchronous, so the driver's timers keep running.
 * Rejects if the flow fails, with the tail of Maestro's output, and stops a
 * flow that runs past its own timeout, so a hung Maestro cannot hold the run
 * until the runner's timeout.
 */
export function runFlow(run, device, flow, vars = {}, { timeoutMs = FLOW_TIMEOUT_MS } = {}) {
  if (!existsSync(MAESTRO)) throw new Error(`Maestro 2.10.0 is not at ${MAESTRO}`);
  const args = ['--device', device, 'test'];
  for (const [key, value] of Object.entries(vars)) args.push('-e', `${key}=${value}`);
  args.push(join(SPIKE, 'drivers/maestro', flow));
  run.log('flow-started', { flow, vars });
  return new Promise((resolve, reject) => {
    const child = spawn(MAESTRO, args, {
      env: {
        ...env,
        JAVA_HOME,
        MAESTRO_CLI_NO_ANALYTICS: '1',
        MAESTRO_DISABLE_UPDATE_CHECK: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      run.log('flow-timed-out', { flow, seconds: Math.round(timeoutMs / 1000) });
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 10_000).unref();
    }, timeoutMs);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      run.log('flow-finished', { flow, code, signal });
      if (timedOut) {
        reject(new Error(`flow ${flow} timed out after ${Math.round(timeoutMs / 1000)} s`));
      } else if (code === 0) resolve();
      else reject(new Error(`flow ${flow} failed (${code}):\n${output.slice(-1500)}`));
    });
  });
}
