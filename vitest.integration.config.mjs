import { defineConfig } from 'vitest/config';

/**
 * L3: tests that need a real PostgreSQL in a container (Testcontainers).
 *
 * Separate from the unit config so that `pnpm run test:unit` stays fast and
 * runnable without Docker. Pulling an image and starting a database is slow the
 * first time, hence the timeouts; they are generous on purpose, because a
 * timeout here would read as "the code is broken" when it means "the image was
 * still downloading".
 */
export default defineConfig({
  test: {
    include: ['apps/**/src/**/*.integration.test.ts', 'packages/**/src/**/*.integration.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 180_000,
    // One container per file rather than per test file in parallel: the runner
    // in CI has little memory, and several PostgreSQL containers at once is how
    // that becomes a confusing out-of-memory failure.
    fileParallelism: false,
  },
});
