import { defineConfig } from 'vitest/config';
import { TEST_FILES, UNIT_EXCLUDE } from './vitest.shared.mjs';

export default defineConfig({
  test: {
    // Hook tests run the hooks as real processes, so they need room to breathe.
    include: TEST_FILES,
    // No L3 and no L6: vitest.shared.mjs says why.
    exclude: UNIT_EXCLUDE,
    environment: 'node',
    testTimeout: 60_000,
    // No coverage settings here on purpose. Coverage is measured by
    // vitest.coverage.config.mjs and nothing else, because the ratchet compares
    // against numbers committed in coverage-baseline.json and two configs
    // writing the same coverage/ directory would mean the baseline was recorded
    // from one set of tests and checked against another. Running this config
    // with --coverage anyway writes no json-summary, so the ratchet says it has
    // nothing to measure rather than measuring the wrong thing.
  },
});
