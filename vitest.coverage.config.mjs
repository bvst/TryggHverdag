import { defineConfig } from 'vitest/config';
import { TEST_FILES } from './vitest.shared.mjs';

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
 *
 * One exception, by name: an adapter that is tested at L2 against a stand-in
 * and listed as a safety path is measured. Today that is
 * `apps/server/src/adapters/healthchecks.ts` — its tests run it against a
 * loopback server, so this run does exercise it, and D-079 makes it a safety
 * path held to the 95 % branch floor. Left out with the rest, it would be a
 * safety file the floor never sees, passing without a word. Every other
 * adapter stays out, including one added tomorrow: the pattern names the
 * exception, so the default stays "excluded".
 *
 * Why two patterns, and not `!(healthchecks).ts`: picomatch reads `!(name)` as
 * "does not start with name" unless it ends the pattern, so that form would
 * quietly measure a `healthchecks-v2.ts`. `!(healthchecks.ts)` at the end is an
 * exact match; `*` + `/**` catches adapters in subfolders, which a
 * one-segment pattern cannot.
 */
export default defineConfig({
  test: {
    include: TEST_FILES,
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      include: ['scripts/**/*.mjs', 'packages/**/src/**/*.ts', 'apps/**/src/**/*.ts'],
      exclude: [
        '**/*.test.*',
        'apps/server/src/adapters/!(healthchecks.ts)',
        'apps/server/src/adapters/*/**',
      ],
      reportsDirectory: 'coverage',
    },
  },
});
