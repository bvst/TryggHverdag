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

describe('the paths these rules cover', () => {
  test('the server domain and the app safety core, which is where decisions are made', () => {
    expect(CLOCK_FREE_PATHS).toEqual([
      'apps/server/src/domain/**/*.ts',
      'apps/mobile/src/safety-core/**/*.ts',
    ]);
  });
});
