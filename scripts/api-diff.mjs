#!/usr/bin/env node
/**
 * AR-08 / D-030: a server change must not break an app version that is still on
 * someone's phone. Every released app version's OpenAPI description is kept in
 * packages/contracts/released/, and the current API is compared against all of
 * them with oasdiff.
 *
 * Usage: pnpm run api:diff
 */
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { exists, run } from './lib/proc.mjs';
import { decideApiDiff } from './lib/gate-decisions.mjs';

const RELEASED_DIR = 'packages/contracts/released';
const CURRENT_SPEC = 'packages/contracts/openapi.json';

export function releasedSpecs(cwd) {
  const dir = path.join(cwd, RELEASED_DIR);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((file) => /\.(json|ya?ml)$/.test(file))
    .sort();
}

function main() {
  const cwd = process.cwd();
  const current = existsSync(path.join(cwd, CURRENT_SPEC)) ? CURRENT_SPEC : null;
  const specs = releasedSpecs(cwd);
  const decision = decideApiDiff({
    releasedSpecs: specs,
    currentSpec: current,
    toolAvailable: exists('oasdiff'),
  });

  process.stdout.write(decision.message + '\n');
  if (!decision.ok) {
    process.exitCode = 1;
    return;
  }
  if (decision.action === 'skip') {
    return;
  }

  const broken = [];
  for (const spec of specs) {
    const result = run(
      'oasdiff',
      ['breaking', path.join(RELEASED_DIR, spec), CURRENT_SPEC, '--fail-on', 'ERR'],
      { cwd },
    );
    process.stdout.write(`\n--- ${spec} ---\n${result.output.trim() || 'no breaking changes'}\n`);
    if (!result.ok) {
      broken.push(spec);
    }
  }

  if (broken.length > 0) {
    process.stdout.write(
      `\nAR-08: this change breaks ${broken.join(', ')}, which real phones are still using. ` +
        'Add a new API version instead of changing this one (D-030).\n',
    );
    process.exitCode = 1;
  }
}

if (import.meta.filename === process.argv[1]) {
  main();
}
