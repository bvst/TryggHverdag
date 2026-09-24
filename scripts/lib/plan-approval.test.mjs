// Applying staging takes two runs the owner starts (D-077): one that plans and
// publishes a fingerprint of the plan, and one that re-plans and applies only
// if its fingerprint is the same. These tests hold both halves.
//
// Why a fingerprint rather than the plan file itself: a saved plan contains the
// database password in plain text, and anyone who can read the repository can
// download a run's artifacts. A hash of the planned changes proves "the same
// plan" without storing anything secret.
import { describe, expect, test } from 'vitest';
import {
  FINGERPRINT_MARKER,
  approvedFingerprint,
  parseRunId,
  planFingerprint,
} from './plan-approval.mjs';

/** The parts of `terraform show -json` that matter, plus the ones that must not. */
function plan({ address = 'clevercloud_nodejs.staging', actions = ['create'], after = {} } = {}) {
  return {
    format_version: '1.2',
    terraform_version: '1.16.4',
    timestamp: '2026-09-24T21:00:00Z',
    resource_changes: [
      {
        address,
        change: { actions, before: null, after: { name: 'staging', ...after }, after_unknown: {} },
      },
    ],
    output_changes: {},
  };
}

describe('planFingerprint', () => {
  test('is the same for the same changes, whatever order the keys come in', () => {
    const a = plan({ after: { region: 'par', flavor: 'nano' } });
    const b = plan({ after: { flavor: 'nano', region: 'par' } });

    expect(planFingerprint(a)).toBe(planFingerprint(b));
    expect(planFingerprint(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  test('ignores when the plan was made, which is not a change to anything', () => {
    const later = { ...plan(), timestamp: '2026-09-25T09:00:00Z' };

    expect(planFingerprint(later)).toBe(planFingerprint(plan()));
  });

  test('changes when what would happen changes', () => {
    expect(planFingerprint(plan({ actions: ['delete'] }))).not.toBe(planFingerprint(plan()));
    expect(planFingerprint(plan({ after: { flavor: 'XS' } }))).not.toBe(planFingerprint(plan()));
    expect(planFingerprint(plan({ address: 'clevercloud_postgresql.staging' }))).not.toBe(
      planFingerprint(plan()),
    );
  });

  test('SEC-03: a secret in the plan changes the fingerprint but never appears in it', () => {
    const secret = 'sentinel-pw-7';
    const withSecret = plan({ after: { password: secret } });

    expect(planFingerprint(withSecret)).not.toContain(secret);
    expect(planFingerprint(withSecret)).not.toBe(planFingerprint(plan()));
  });
});

describe('parseRunId', () => {
  test.each([
    ['12345678901', '12345678901'],
    [' 12345678901 ', '12345678901'],
    ['https://github.com/bvst/TryggHverdag/actions/runs/12345678901', '12345678901'],
    ['https://github.com/bvst/TryggHverdag/actions/runs/12345678901/job/99', '12345678901'],
  ])('reads %j as run %s', (given, id) => {
    expect(parseRunId(given)).toBe(id);
  });

  test.each(['', 'latest', 'run 12'])(
    'refuses %j rather than guessing which run was meant',
    (given) => {
      expect(() => parseRunId(given)).toThrow(/run/);
    },
  );
});

describe('approvedFingerprint', () => {
  const FINGERPRINT = 'a'.repeat(64);
  const run = {
    workflowName: 'infra-staging',
    headBranch: 'main',
    conclusion: 'success',
    jobs: [{ name: 'plan', conclusion: 'success' }],
  };
  const log = `plan\tFingerprint\t2026-09-24T21:00:00Z ${FINGERPRINT_MARKER}${FINGERPRINT}\n`;

  test('is the fingerprint a successful plan run on main published', () => {
    expect(approvedFingerprint(run, log)).toBe(FINGERPRINT);
  });

  test.each([
    ['another workflow', { workflowName: 'ci' }, /infra-staging/],
    ['a run on another branch', { headBranch: 'feat/x' }, /main/],
    ['a run that failed', { conclusion: 'failure' }, /succeed/],
    ['a run that did not plan', { jobs: [{ name: 'apply', conclusion: 'success' }] }, /plan/],
  ])('refuses %s', (_what, change, message) => {
    expect(() => approvedFingerprint({ ...run, ...change }, log)).toThrow(message);
  });

  test('refuses a plan run that published no fingerprint', () => {
    expect(() => approvedFingerprint(run, 'plan\tNo changes.\n')).toThrow(/fingerprint/);
  });

  test('refuses a run that published two different ones, rather than picking', () => {
    const two = `${log}${FINGERPRINT_MARKER}${'b'.repeat(64)}\n`;

    expect(() => approvedFingerprint(run, two)).toThrow(/more than one/);
  });
});
