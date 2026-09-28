import { defineConfig } from 'vitest/config';
import { JEST_EXPO_FILES, TEST_FILES } from './vitest.shared.mjs';

export default defineConfig({
  test: {
    // Hook tests run the hooks as real processes, so they need room to breathe.
    include: TEST_FILES,
    // L3 needs Docker and L6 is its own gate, so neither belongs in the run
    // that must stay fast and work on any machine. Without this they would be
    // swept up by the patterns above and a laptop with no Docker would see a
    // confusing failure rather than a passing unit suite.
    exclude: [
      '**/node_modules/**',
      JEST_EXPO_FILES,
      '**/*.integration.test.ts',
      '**/*.system.test.ts',
    ],
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
