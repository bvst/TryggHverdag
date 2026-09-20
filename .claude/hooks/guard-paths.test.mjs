// req-coverage: fixtures-only — the IDs below are sample data for testing the gates.
// HK-02: separation of duties. The agent that writes code cannot touch tests,
// and the agent that writes tests cannot touch production code (RG-03).
import { describe, expect, test } from 'vitest';
import { ALLOWED, BLOCKED, edit, runHook } from './test-helpers.mjs';

const implementer = [
  '--agent',
  'implementer',
  '--deny',
  '**/*.test.ts',
  '--deny',
  '**/*.test.mjs',
  '--deny',
  'packages/test-kit/**',
];
const testAuthor = [
  '--agent',
  'test-author',
  '--allow',
  '**/*.test.ts',
  '--allow',
  'packages/test-kit/**',
];

describe('HK-02: implementer may not change tests', () => {
  test('blocks a test file and says why', () => {
    const result = runHook('guard-paths.mjs', {
      args: implementer,
      input: edit('/repo/apps/server/src/journey.test.ts'),
      cwd: '/repo',
    });
    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain('RG-03');
    expect(result.stderr).toContain('journey.test.ts');
  });

  test('blocks the test kit, where the fakes live', () => {
    const result = runHook('guard-paths.mjs', {
      args: implementer,
      input: edit('/repo/packages/test-kit/src/fake-clock.ts'),
      cwd: '/repo',
    });
    expect(result.status).toBe(BLOCKED);
  });

  test('allows production code, which is its job', () => {
    const result = runHook('guard-paths.mjs', {
      args: implementer,
      input: edit('/repo/apps/server/src/domain/journey.ts'),
      cwd: '/repo',
    });
    expect(result.status).toBe(ALLOWED);
  });
});

describe('HK-02: test-author may only change tests', () => {
  test('allows a test file', () => {
    const result = runHook('guard-paths.mjs', {
      args: testAuthor,
      input: edit('/repo/apps/server/src/journey.test.ts'),
      cwd: '/repo',
    });
    expect(result.status).toBe(ALLOWED);
  });

  test('blocks production code and names what it may change', () => {
    const result = runHook('guard-paths.mjs', {
      args: testAuthor,
      input: edit('/repo/apps/server/src/domain/journey.ts'),
      cwd: '/repo',
    });
    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain('test-author');
  });
});

describe('HK-02: anything outside the repository', () => {
  test('is blocked for every role', () => {
    const result = runHook('guard-paths.mjs', {
      args: implementer,
      input: edit('/etc/passwd'),
      cwd: '/repo',
    });
    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain('outside the repository');
  });
});

describe('HK-02: tools that do not touch a file', () => {
  test('pass straight through', () => {
    const result = runHook('guard-paths.mjs', {
      args: implementer,
      input: { tool_name: 'Bash', tool_input: { command: 'pnpm run test:unit' } },
      cwd: '/repo',
    });
    expect(result.status).toBe(ALLOWED);
  });
});
