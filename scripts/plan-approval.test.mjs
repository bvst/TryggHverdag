// BUG-1: staging's first plan run (36024686949) planned fine and then failed its
// Fingerprint step with "plan-approval: EAGAIN: resource temporarily
// unavailable, read". The command-line half of plan approval read its input in
// one synchronous read, and a pipe whose writer has not written yet answers
// that with EAGAIN instead of waiting. In the workflow the writer is
// `terraform show -json`, which is never instant.
//
// So these put a slow writer in front of the script the way the workflow's
// steps do: a shell pipeline. The pure logic is tested in
// scripts/lib/plan-approval.test.mjs; this is only about reading the plan.
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, test } from 'vitest';
import { FINGERPRINT_MARKER, planFingerprint } from './lib/plan-approval.mjs';

const CLI = path.join(import.meta.dirname, 'plan-approval.mjs');

const PLAN = {
  resource_changes: [{ address: 'clevercloud_nodejs.staging', change: { actions: ['create'] } }],
  output_changes: {},
};

/** Runs the script behind a writer that waits half a second, as `terraform show` does. */
function behindSlowWriter(args, { path: searchPath = process.env.PATH } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'plan-approval-'));
  const planFile = path.join(dir, 'plan.json');
  writeFileSync(planFile, JSON.stringify(PLAN));
  return spawnSync(
    'bash',
    ['-c', 'set -o pipefail; (sleep 0.5; cat "$PLAN_FILE") | "$NODE" "$CLI" "$@"', 'bash', ...args],
    {
      encoding: 'utf8',
      env: { PATH: searchPath, PLAN_FILE: planFile, NODE: process.execPath, CLI },
      timeout: 20_000,
    },
  );
}

describe('plan-approval.mjs reads a plan that arrives late', () => {
  test('BUG-1: fingerprint waits for the plan, and prints the fingerprint of all of it', () => {
    const result = behindSlowWriter(['fingerprint']);

    expect(result.stdout).not.toContain('EAGAIN');
    expect(result.stdout).toBe(`${FINGERPRINT_MARKER}${planFingerprint(PLAN)}\n`);
    expect(result.status).toBe(0);
  });

  test('BUG-1: matches waits for the plan too, before it asks GitHub about the run', () => {
    // A stand-in gh that refuses: the only way to reach it is to have read
    // the plan first, so its refusal in the output proves the read worked.
    const bin = mkdtempSync(path.join(tmpdir(), 'plan-approval-gh-'));
    writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\necho "stand-in gh refused" >&2\nexit 1\n');
    chmodSync(path.join(bin, 'gh'), 0o755);

    const result = behindSlowWriter(['matches', '123'], {
      path: `${bin}${path.delimiter}${String(process.env.PATH)}`,
    });

    expect(result.stdout).not.toContain('EAGAIN');
    expect(result.stdout).toContain('::error::plan-approval:');
    expect(result.stdout).toContain('gh run view 123');
    expect(result.status).toBe(1);
  });
});
