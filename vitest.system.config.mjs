import { defineConfig } from 'vitest/config';

/**
 * L6: whole flows through the real API, with fakes at the edges and a clock the
 * test moves. No database and no network, so these are fast — which matters,
 * because this is where the alert behaviour lives (SM-01 to SM-10) and it needs
 * to be cheap enough to run on every edit.
 */
export default defineConfig({
  test: {
    include: ['apps/**/src/**/*.system.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
  },
});
