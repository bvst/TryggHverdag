#!/usr/bin/env node
/**
 * D-036: on safety code, the tests must catch planted bugs — at least 80 % of
 * them. Coverage says a line ran; the mutation score says a bug in that line
 * would have been noticed.
 *
 * Usage:
 *   pnpm run mutation [--incremental] [--only-if-safety-paths-changed] [--base origin/main]
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { changedFiles } from './lib/git.mjs';
import { run } from './lib/proc.mjs';
import { decideMutation } from './lib/gate-decisions.mjs';

const CONFIGS = ['stryker.config.mjs', 'stryker.config.json', 'stryker.conf.json'];

export function strykerConfigured(cwd) {
  return CONFIGS.some((file) => existsSync(path.join(cwd, file)));
}

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

function main() {
  const cwd = process.cwd();
  const decision = decideMutation({
    changed: changedFiles({ base: argValue('--base', 'origin/main'), cwd }),
    onlyIfSafetyPathsChanged: process.argv.includes('--only-if-safety-paths-changed'),
    configured: strykerConfigured(cwd),
  });

  process.stdout.write(decision.message + '\n');
  if (!decision.ok) {
    process.exitCode = 1;
    return;
  }
  if (decision.action === 'skip') {
    return;
  }

  const args = ['stryker', 'run'];
  if (process.argv.includes('--incremental')) {
    args.push('--incremental');
  }
  const result = run('pnpm', ['exec', ...args], { cwd });
  process.stdout.write(result.output);
  if (!result.ok) {
    process.stdout.write(
      '\nD-036: the mutation score on safety code is below 80 %. Tests that run the code but ' +
        'would not notice it breaking are not protection — strengthen them.\n',
    );
    process.exitCode = 1;
  }
}

if (import.meta.filename === process.argv[1]) {
  main();
}
