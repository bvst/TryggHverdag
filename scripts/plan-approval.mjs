#!/usr/bin/env node
/**
 * The two halves of applying staging (D-077); the reasoning is in
 * scripts/lib/plan-approval.mjs. Both read `terraform show -json <plan>` on
 * stdin — which holds secrets in plain text, so it is hashed here and nothing
 * of it is printed.
 *
 *   node scripts/plan-approval.mjs fingerprint
 *       prints the plan's fingerprint line, for the plan run's log
 *   node scripts/plan-approval.mjs matches <run ID or address>
 *       exits 0 only if the plan is the one that run published, after
 *       checking the run; otherwise exits 1 and says why (needs GH_TOKEN with
 *       actions: read)
 *
 * One command does the whole check so that a failure anywhere in it fails its
 * step with its own reason. An earlier version read the approved fingerprint
 * into a step output, where a failure to read it passed silently and surfaced
 * later as the wrong reason (code-reviewer, test-auditor and
 * privacy-security-reviewer on INF-07).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import {
  FINGERPRINT_MARKER,
  approvedFingerprint,
  parseRunId,
  planFingerprint,
  samePlan,
} from './lib/plan-approval.mjs';

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const [command, argument] = process.argv.slice(2);
try {
  if (command === 'fingerprint') {
    const plan = JSON.parse(readFileSync(0, 'utf8'));
    process.stdout.write(`${FINGERPRINT_MARKER}${planFingerprint(plan)}\n`);
  } else if (command === 'matches') {
    const id = parseRunId(argument ?? '');
    const current = planFingerprint(JSON.parse(readFileSync(0, 'utf8')));
    const run = JSON.parse(
      gh('run', 'view', id, '--json', 'workflowName,event,headBranch,conclusion,jobs'),
    );
    const approved = approvedFingerprint(run, gh('run', 'view', id, '--log'));
    process.stdout.write(`${samePlan(current, approved, id)}\n`);
  } else {
    throw new Error('Usage: plan-approval.mjs fingerprint | matches <run>, with the plan on stdin');
  }
} catch (error) {
  process.stdout.write(
    `::error::plan-approval: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
