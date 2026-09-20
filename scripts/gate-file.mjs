#!/usr/bin/env node
/**
 * The per-file gate (HK-04) — what runs after every edit.
 *
 * Minimal version, added with the hooks in INF-02 so the post-edit hook has
 * something real to call. INF-03 replaces it with the full version: affected
 * tests, import rules and requirement coverage for the file that changed.
 *
 * Usage: pnpm run gate:file <path>...
 */
import { spawnSync } from 'node:child_process';
import process from 'node:process';

/** Files these checks apply to: our own code, not planning documents or spikes. */
const CHECKABLE = /\.(ts|tsx|mts|cts|js|mjs|cjs|json|ya?ml)$/;
const NOT_OURS = /^(docs|spikes|node_modules)\//;

export function filesToCheck(args) {
  return args.filter((arg) => arg !== '--' && CHECKABLE.test(arg) && !NOT_OURS.test(arg));
}

function run(what, command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 160_000 });
  if (result.error) {
    return { what, ok: false, output: result.error.message };
  }
  return {
    what,
    ok: result.status === 0,
    output: (result.stdout ?? '') + (result.stderr ?? ''),
  };
}

function main() {
  const files = filesToCheck(process.argv.slice(2));
  if (files.length === 0) {
    return;
  }

  const failures = [
    run('formatting', 'pnpm', ['exec', 'prettier', '--check', ...files]),
    run('lint', 'pnpm', ['exec', 'eslint', ...files]),
    run('types', 'pnpm', ['exec', 'turbo', 'run', 'typecheck']),
  ].filter((result) => !result.ok);

  if (failures.length > 0) {
    for (const failure of failures) {
      process.stdout.write(`\n--- ${failure.what} ---\n${failure.output.trim()}\n`);
    }
    process.stdout.write(
      `\n${String(failures.length)} check(s) failed for: ${files.join(', ')}\n` +
        'Fix them before moving on — the same checks run in CI.\n',
    );
    process.exitCode = 1;
  }
}

if (import.meta.filename === process.argv[1]) {
  main();
}
