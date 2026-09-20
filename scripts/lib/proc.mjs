// Running other tools, in one place, so every gate script reports failures the
// same way: what ran, whether it passed, and what it printed.
import { spawnSync } from 'node:child_process';

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, timeout?: number }} options
 * @returns {{ ok: boolean, status: number | null, output: string }}
 */
export function run(command, args, { cwd = process.cwd(), timeout = 590_000 } = {}) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout });
  if (result.error) {
    return { ok: false, status: null, output: result.error.message };
  }
  return {
    ok: result.status === 0,
    status: result.status,
    output: (result.stdout ?? '') + (result.stderr ?? ''),
  };
}

/** True when a command exists on this machine. */
export function exists(command) {
  return run('which', [command]).ok;
}

/** The scripts a package.json actually has — gates skip what does not exist yet. */
export function packageScripts(cwd = process.cwd()) {
  const result = run(
    'node',
    ['-e', 'process.stdout.write(JSON.stringify(require("./package.json").scripts ?? {}))'],
    { cwd, timeout: 20_000 },
  );
  if (!result.ok) {
    return {};
  }
  try {
    return JSON.parse(result.output);
  } catch {
    return {};
  }
}
