import { defineConfig } from 'vitest/config';

/**
 * The run the coverage ratchet measures (RG-04).
 *
 * Unit (L2, L5) and system (L6) together, and deliberately not integration
 * (L3). Coverage numbers are committed in coverage-baseline.json, so the set of
 * tests behind them has to be the same everywhere — and L3 needs Docker, which
 * a cloud session does not have. A figure that meant one thing on CI and
 * another on a laptop would make the ratchet argue with itself.
 *
 * What that costs, and how it is paid: `apps/server/src/adapters/**` is covered
 * by L3 and by nothing else, by design — adapters are the code that touches the
 * outside world, and the testing strategy tests them against the real thing
 * rather than against a mock of it. Measuring them here would report 0 % for
 * code that is in fact tested, so they are left out of the measurement and
 * their protection is the integration suite. If an adapter ever stops having
 * one, that is a gap in `*.integration.test.ts`, not a number to argue with.
 */
export default defineConfig({
  test: {
    include: [
      '.claude/hooks/**/*.test.mjs',
      'scripts/**/*.test.mjs',
      'packages/**/src/**/*.test.ts',
      'apps/**/src/**/*.test.ts',
      'apps/**/src/**/*.system.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      include: ['scripts/**/*.mjs', 'packages/**/src/**/*.ts', 'apps/**/src/**/*.ts'],
      exclude: ['**/*.test.*', 'apps/server/src/adapters/**'],
      reportsDirectory: 'coverage',
    },
  },
});
