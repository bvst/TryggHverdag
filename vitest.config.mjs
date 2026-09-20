import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Hook tests run the hooks as real processes, so they need room to breathe.
    include: [
      '.claude/hooks/**/*.test.mjs',
      'scripts/**/*.test.mjs',
      'packages/**/src/**/*.test.ts',
      'apps/**/src/**/*.test.ts',
    ],
    environment: 'node',
    testTimeout: 60_000,
    coverage: {
      provider: 'v8',
      // json-summary is what the coverage ratchet (RG-04) reads.
      reporter: ['text-summary', 'json-summary'],
      include: ['scripts/**/*.mjs', 'packages/**/src/**/*.ts', 'apps/**/src/**/*.ts'],
      exclude: ['**/*.test.*'],
      reportsDirectory: 'coverage',
    },
  },
});
