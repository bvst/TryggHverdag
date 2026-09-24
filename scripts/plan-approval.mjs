#!/usr/bin/env node
/**
 * The two halves of applying staging (D-077); the reasoning is in
 * scripts/lib/plan-approval.mjs.
 *
 *   node scripts/plan-approval.mjs fingerprint < plan.json
 *       reads `terraform show -json` on stdin and prints the fingerprint line
 *   node scripts/plan-approval.mjs approved <run ID or address>
 *       prints the fingerprint that plan run published, after checking the run
 *       (needs GH_TOKEN with actions: read)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import {
  FINGERPRINT_MARKER,
  approvedFingerprint,
  parseRunId,
  planFingerprint,
} from './lib/plan-approval.mjs';

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const [command, argument] = process.argv.slice(2);
try {
  if (command === 'fingerprint') {
    // The plan JSON holds secrets in plain text. It is read here and hashed;
    // nothing of it is printed.
    const plan = JSON.parse(readFileSync(0, 'utf8'));
    process.stdout.write(`${FINGERPRINT_MARKER}${planFingerprint(plan)}\n`);
  } else if (command === 'approved') {
    const id = parseRunId(argument ?? '');
    const run = JSON.parse(
      gh('run', 'view', id, '--json', 'workflowName,headBranch,conclusion,jobs'),
    );
    process.stdout.write(`${approvedFingerprint(run, gh('run', 'view', id, '--log'))}\n`);
  } else {
    throw new Error('Usage: plan-approval.mjs fingerprint < plan.json | approved <run>');
  }
} catch (error) {
  process.stderr.write(
    `plan-approval: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
