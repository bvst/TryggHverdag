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
  },
});
