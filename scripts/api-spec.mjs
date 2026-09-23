#!/usr/bin/env node
/**
 * Writes packages/contracts/openapi.json from the contract (D-030, AR-08).
 *
 * The description is generated rather than written, because a hand-kept copy
 * beside the schemas is a second source of truth and the second one is always
 * the one that goes stale. `pnpm run api:diff` compares the released versions
 * against this file, so a stale file would mean the compatibility gate was
 * checking a description nobody serves — which is worse than not checking,
 * because it looks like it checked.
 *
 * A test in packages/contracts holds the committed file to what the contract
 * generates today, so forgetting to run this is caught rather than shipped —
 * which is why this script only writes, and does not also check.
 *
 * Usage: pnpm run api:spec
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const SPEC = 'packages/contracts/openapi.json';

async function main() {
  const cwd = process.cwd();
  const file = path.join(cwd, SPEC);
  const { openApiJson } = await import(
    path.join(cwd, 'packages', 'contracts', 'src', 'openapi.ts')
  );

  writeFileSync(file, await openApiJson());
  process.stdout.write(`api:spec: wrote ${SPEC}.\n`);
}

if (import.meta.filename === process.argv[1]) {
  await main();
}
