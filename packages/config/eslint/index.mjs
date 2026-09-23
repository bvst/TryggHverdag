// Shared ESLint flat config — test level L1 (static).
//
// Two jobs:
//   1. strict, type-aware TypeScript rules for every package;
//   2. the architecture rules that a type checker cannot see (AR-03).
//
// Import-boundary rules (AR-10) live in ../dependency-cruiser.cjs, because they
// are about the shape of the repository rather than the shape of a file.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Code where safety decisions are made. Here the clock is a port that tests
 * control, never something the code reads for itself (AR-03), and there are no
 * in-memory timers — the watchdog owns time (AR-06).
 */
export const CLOCK_FREE_PATHS = [
  'apps/server/src/domain/**/*.ts',
  'apps/mobile/src/safety-core/**/*.ts',
];

const CLOCK_MESSAGE =
  'AR-03: safety code must not read the clock. Take the time from the injected clock port, so tests can control it.';
const TIMER_MESSAGE =
  'AR-06: safety code must not keep time in memory. Timing lives in the database-backed watchdog, so a restart loses nothing.';

/** Rules applied to CLOCK_FREE_PATHS. Exported on its own so tests can assert on it. */
export const clockFreeRules = {
  'no-restricted-syntax': [
    'error',
    // Zero arguments only. `new Date()` asks the machine what time it is, which
    // is the thing AR-03 forbids; `new Date(text)` turns a value someone handed
    // in into a moment, which is a parse and reads no clock at all.
    //
    // The rule used to ban both. That sounds stricter and is not: it pushed the
    // one place that must convert what PostgreSQL said into a Date out of
    // domain/, and so out of the 95 % branch floor and the mutation gate — away
    // from the protection this rule exists to provide. See D-067.
    { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: CLOCK_MESSAGE },
    {
      selector: "MemberExpression[object.name='Date'][property.name='now']",
      message: CLOCK_MESSAGE,
    },
    {
      selector: "MemberExpression[object.name='performance'][property.name='now']",
      message: CLOCK_MESSAGE,
    },
  ],
  'no-restricted-globals': [
    'error',
    { name: 'setTimeout', message: TIMER_MESSAGE },
    { name: 'setInterval', message: TIMER_MESSAGE },
  ],
};

/** Paths no lint run should walk into. */
export const IGNORED_PATHS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.turbo/**',
  '**/.expo/**',
  'spikes/**', // throwaway by definition — never shipped, never linted
  'docs/**', // planning material, including the file templates INF-02 copies in
];

/**
 * The repository's ESLint configuration.
 *
 * @param {{ rootDir: string }} options rootDir is the workspace root, which
 *   type-aware linting needs to find each package's tsconfig.json.
 * @returns {import('eslint').Linter.Config[]}
 */
export function trygghverdagEslintConfig({ rootDir }) {
  return tseslint.config(
    { ignores: IGNORED_PATHS },
    {
      files: ['**/*.{ts,tsx,mts,cts,js,mjs,cjs}'],
      extends: [js.configs.recommended],
      languageOptions: {
        globals: { ...globals.node },
      },
    },
    {
      files: ['**/*.{ts,tsx,mts,cts}'],
      extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir: rootDir },
      },
    },
    {
      // Tooling and scripts are plain JavaScript: no type information to lint with.
      files: ['**/*.{js,mjs,cjs}'],
      extends: [tseslint.configs.disableTypeChecked],
      languageOptions: {
        parserOptions: { projectService: false, project: false },
      },
    },
    {
      files: CLOCK_FREE_PATHS,
      rules: clockFreeRules,
    },
    // Prettier owns formatting; it must come last so it can switch off style rules.
    prettier,
  );
}

export default trygghverdagEslintConfig;
