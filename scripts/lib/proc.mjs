// Running other tools, in one place, so every gate script reports failures the
// same way: what ran, whether it passed, and what it printed.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

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

/**
 * The scripts a package.json actually has — gates skip what does not exist yet.
 *
 * Read from the file, and never from a subprocess's output. `run` above hands
 * back stdout and stderr glued together, so a single warning from node — an
 * experimental flag, a deprecation, an environment variable someone exported —
 * used to land in the middle of the JSON. Parsing failed, the catch returned
 * "no scripts", and every gate then reported every step as "not possible yet"
 * and passed. A gate that runs nothing must never be able to look like a gate
 * that passed, so this throws rather than shrugging.
 */
export function packageScripts(cwd = process.cwd()) {
  const file = path.join(cwd, 'package.json');
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(`Could not read ${file}, so no gate can tell what it may run.`, {
      cause: error,
    });
  }
  try {
    return JSON.parse(text).scripts ?? {};
  } catch (error) {
    throw new Error(`${file} is not valid JSON, so no gate can tell what it may run.`, {
      cause: error,
    });
  }
}
