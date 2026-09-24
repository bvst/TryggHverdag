#!/usr/bin/env node
/**
 * The staging smoke test (INF-07): after a deploy, the API answers and the
 * worker has checked in since. Run by deploy-staging.yml after every deploy;
 * what it checks and why is in scripts/lib/smoke.mjs.
 *
 * Usage: pnpm run smoke [--url https://…]   (defaults to staging)
 */
import process from 'node:process';
import { smokeTest } from './lib/smoke.mjs';
import { STAGING_URL } from './lib/staging.mjs';

const args = process.argv.slice(2);
const urlIndex = args.indexOf('--url');
const url = urlIndex === -1 ? STAGING_URL : (args[urlIndex + 1] ?? STAGING_URL);

const result = await smokeTest({
  url,
  log: (line) => {
    process.stdout.write(`smoke: ${line}\n`);
  },
});
process.stdout.write(`smoke: ${result.reason}\n`);
if (!result.ok) {
  process.exitCode = 1;
}
