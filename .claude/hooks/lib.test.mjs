// req-coverage: fixtures-only — the IDs below are sample data for testing the gates.
// The shared helpers every hook is built on. If these are wrong, every gate is
// wrong, so they are tested directly.
import { describe, expect, test } from 'vitest';
import { globToRegExp, matchesAny, relPath, tail } from './lib.mjs';

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
