// req-coverage: fixtures-only — the IDs below name the architecture rules the
// config enforces, not product requirements.
//
// The clock rules had no tests, although the comment beside them said they did.
// They are the static half of AR-03: if the selector stops matching, domain
// code can read the machine's clock and nothing goes red — the failure is a
// safety decision made against the wrong time, discovered in production.
import { Linter } from 'eslint';
import { describe, expect, test } from 'vitest';
import { CLOCK_FREE_PATHS, clockFreeRules } from './index.mjs';

const linter = new Linter();

/** @returns {string[]} the messages the clock rules produce for this source. */
const complaints = (code) =>
  linter
    .verify(code, [{ files: ['**/*.ts'], rules: clockFreeRules }], 'domain/thing.ts')
    .map((m) => m.message);

describe('AR-03: safety code must not read the clock', () => {
  test.each([
    ['new Date()', 'const t = new Date();'],
    ['Date.now()', 'const t = Date.now();'],
    ['performance.now()', 'const t = performance.now();'],
  ])('%s is refused', (_name, code) => {
    expect(complaints(code)).toEqual([expect.stringContaining('AR-03')]);
  });

  test.each([
    ['a string the caller supplied', 'const t = new Date(text);'],
    ['PostgreSQL text', "const t = new Date('2026-09-23T05:18:34.386Z');"],
    ['milliseconds', 'const t = new Date(ms);'],
  ])('parsing %s is allowed — it reads no clock', (_name, code) => {
    // This is not a loosening for convenience. Refusing it moved the one
    // conversion from what the database said into a Date out of domain/, and
    // so out of the mutation gate that guards exactly this kind of code (D-067).
    expect(complaints(code)).toEqual([]);
  });
});

describe('AR-06: safety code must not keep time in memory', () => {
  test.each([['setTimeout'], ['setInterval']])('%s is refused', (name) => {
    expect(complaints(`${name}(fn, 1000);`)).toEqual([expect.stringContaining('AR-06')]);
  });
});

/**
 * The messages the clock rules produce for `code` in a file at `file`, with the
 * rules applied the way the repository applies them: to CLOCK_FREE_PATHS, and
 * nowhere else. Every .ts and .tsx file is linted; only those paths get the
 * clock rules.
 */
const complaintsAt = (file, code) =>
  linter
    .verify(
      code,
      [
        {
          files: ['**/*.{ts,tsx}'],
          languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
        },
        { files: CLOCK_FREE_PATHS, rules: clockFreeRules },
      ],
      file,
    )
    .map((m) => m.message);

/** A screen in the safety core that reads the clock while it renders. */
const COMPONENT = 'export const Countdown = () => <Text>{Date.now()}</Text>;';

describe('the paths these rules cover', () => {
  test('the server domain and the app safety core, which is where decisions are made', () => {
    // The safety core's .tsx files too, amended 2026-09-26: .tsx is normal in
    // the app, and a component in the safety core is safety code like any other.
    //
    // And the server's modules, amended for BUG-10 (D-092, D-095): the
    // journey service decides when a journey started, and every module is
    // handed its clock, so none of them may read one.
    expect(CLOCK_FREE_PATHS).toEqual([
      'apps/server/src/domain/**/*.ts',
      'apps/server/src/modules/**/*.ts',
      'apps/mobile/src/safety-core/**/*.{ts,tsx}',
    ]);
  });

  test.each([
    'apps/mobile/src/safety-core/countdown.tsx',
    'apps/mobile/src/safety-core/journey/check-in-view.tsx',
  ])('AR-03: a .tsx file in the app safety core may not read the clock either: %s', (file) => {
    expect(complaintsAt(file, COMPONENT)).toEqual([expect.stringContaining('AR-03')]);
  });

  test.each([
    'apps/server/src/modules/journeys/service.ts',
    'apps/server/src/modules/health/service.ts',
  ])('BUG-10: AR-03: a .ts file in the server modules may not read the clock: %s', (file) => {
    expect(complaintsAt(file, 'const t = Date.now();')).toEqual([expect.stringContaining('AR-03')]);
  });

  // REL-10 (the spec's AC5, its lint clause): the staging canary decides
  // everything on the database's times, so its domain file and its module
  // read no clock and keep no timer of their own; the module is handed a
  // Wait. Both sit under paths the rules already cover, so this passes before
  // the files exist, and holds the day a path list is narrowed.
  test.each(['apps/server/src/domain/canary.ts', 'apps/server/src/modules/canary/run.ts'])(
    'REL-10-AC5: AR-03: the canary’s %s may not read the clock, nor keep time in memory',
    (file) => {
      expect(complaintsAt(file, 'const t = Date.now();')).toEqual([
        expect.stringContaining('AR-03'),
      ]);
      expect(complaintsAt(file, 'const d = new Date();')).toEqual([
        expect.stringContaining('AR-03'),
      ]);
      expect(complaintsAt(file, 'setTimeout(check, 2000);')).toEqual([
        expect.stringContaining('AR-06'),
      ]);
    },
  );

  test('AR-06: nor keep time in memory there', () => {
    expect(
      complaintsAt('apps/mobile/src/safety-core/countdown.tsx', 'setInterval(tick, 1000);'),
    ).toEqual([expect.stringContaining('AR-06')]);
  });

  test('a .ts file in the app safety core is still covered', () => {
    expect(complaintsAt('apps/mobile/src/safety-core/journey.ts', 'const t = Date.now();')).toEqual(
      [expect.stringContaining('AR-03')],
    );
  });

  test('a .tsx file outside the safety core is not these rules to judge', () => {
    // Not vacuous the other way either: the same component elsewhere passes,
    // so the complaints above come from the path, not from the harness.
    expect(complaintsAt('apps/mobile/src/app/index.tsx', COMPONENT)).toEqual([]);
  });
});
