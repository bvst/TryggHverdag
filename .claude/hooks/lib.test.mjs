// req-coverage: fixtures-only — the IDs below are sample data for testing the gates.
// The shared helpers every hook is built on. If these are wrong, every gate is
// wrong, so they are tested directly.
import { afterEach, describe, expect, test, vi } from 'vitest';
import { globToRegExp, inReviewJob, matchesAny, relPath, tail } from './lib.mjs';

describe('globToRegExp', () => {
  test('** crosses folders, * does not', () => {
    expect(globToRegExp('**/*.test.ts').test('apps/server/src/journey.test.ts')).toBe(true);
    expect(globToRegExp('**/*.test.ts').test('journey.test.ts')).toBe(true);
    expect(globToRegExp('apps/*/src/**').test('apps/server/src/domain/journey.ts')).toBe(true);
    expect(globToRegExp('apps/*/src/**').test('packages/contracts/src/index.ts')).toBe(false);
  });

  test('a glob matches the whole path, not a part of it', () => {
    expect(globToRegExp('**/*.test.ts').test('apps/server/src/journey.ts')).toBe(false);
    expect(globToRegExp('packages/test-kit/**').test('packages/test-kit-other/a.ts')).toBe(false);
  });

  test('dots are literal, so a.test.ts is not matched by a?test.ts patterns', () => {
    expect(globToRegExp('*.test.ts').test('axtestxts')).toBe(false);
  });
});

describe('matchesAny', () => {
  test('is true when any glob matches', () => {
    const globs = ['**/*.test.ts', 'apps/mobile/e2e/**'];
    expect(matchesAny('apps/mobile/e2e/home.yaml', globs)).toBe(true);
    expect(matchesAny('apps/server/src/api.ts', globs)).toBe(false);
  });
});

describe('relPath', () => {
  test('makes a path relative to the session folder, with forward slashes', () => {
    expect(relPath('/repo/apps/server/src/api.ts', '/repo')).toBe('apps/server/src/api.ts');
    expect(relPath('apps/server/src/api.ts', '/repo')).toBe('apps/server/src/api.ts');
  });

  test('a path outside the repository starts with .., which guards use to block it', () => {
    expect(relPath('/etc/passwd', '/repo').startsWith('..')).toBe(true);
  });
});

describe('tail', () => {
  test('keeps the end of long output, which is where failures are', () => {
    expect(tail('abcdef', 3)).toBe('…def');
    expect(tail('abc', 10)).toBe('abc');
  });
});

// BUG-31, review loop 2 (D-119): the CI review job's stand-down was written out
// twice, once in stop-gate.mjs and once in progress-gate.mjs, so the two could
// drift apart — one hook standing down where the other does not. It is one
// rule, in one place. Both variables, exactly: GITHUB_ACTIONS=true is set in
// every CI job, not only the reviews, so neither variable alone may turn a gate
// off, and the review-job switch has to say 1.
describe('BUG-31: inReviewJob, the one rule for the CI review job stand-down (D-119)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test.each([
    {
      how: 'both variables set',
      env: { GITHUB_ACTIONS: 'true', TRYGGHVERDAG_REVIEW_JOB: '1' },
      expected: true,
    },
    { how: 'only GITHUB_ACTIONS=true', env: { GITHUB_ACTIONS: 'true' }, expected: false },
    {
      how: 'only TRYGGHVERDAG_REVIEW_JOB=1',
      env: { TRYGGHVERDAG_REVIEW_JOB: '1' },
      expected: false,
    },
    {
      how: 'GITHUB_ACTIONS=true, REVIEW_JOB=0',
      env: { GITHUB_ACTIONS: 'true', TRYGGHVERDAG_REVIEW_JOB: '0' },
      expected: false,
    },
    {
      how: 'GITHUB_ACTIONS=TRUE, REVIEW_JOB=1',
      env: { GITHUB_ACTIONS: 'TRUE', TRYGGHVERDAG_REVIEW_JOB: '1' },
      expected: false,
    },
    { how: 'neither variable', env: {}, expected: false },
  ])('BUG-31: with $how, inReviewJob is $expected', ({ env, expected }) => {
    expect(inReviewJob(env)).toBe(expected);
  });

  // The hooks call it without an argument, so the default has to be the
  // process's own environment. Both directions, so a default that is constant
  // either way is caught.
  test("BUG-31: with no argument, inReviewJob reads the process's own environment", () => {
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    vi.stubEnv('TRYGGHVERDAG_REVIEW_JOB', '1');
    expect(inReviewJob()).toBe(true);

    vi.stubEnv('TRYGGHVERDAG_REVIEW_JOB', '0');
    expect(inReviewJob()).toBe(false);
  });
});
