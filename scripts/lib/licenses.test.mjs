// SEC-06. The interesting cases are the expressions, because that is where a
// licence check quietly lets something through.
import { describe, expect, test } from 'vitest';
import { isAllowed, reviewLicences } from './licenses.mjs';

describe('isAllowed', () => {
  test.each([
    ['MIT', true],
    ['Apache-2.0', true],
    ['MPL-2.0', true],
    ['GPL-3.0', false],
    ['AGPL-3.0-only', false],
    ['SSPL-1.0', false],
  ])('%s → %s', (licence, expected) => {
    expect(isAllowed(licence)).toBe(expected);
  });

  test('"(MIT OR GPL-3.0)" passes, because we may choose MIT', () => {
    expect(isAllowed('(MIT OR GPL-3.0)')).toBe(true);
  });

  test('"(MIT AND GPL-3.0)" does not, because both apply', () => {
    expect(isAllowed('(MIT AND GPL-3.0)')).toBe(false);
  });

  test('an empty licence is never allowed', () => {
    expect(isAllowed('')).toBe(false);
  });
});

describe('reviewLicences', () => {
  test('passes a clean dependency tree', () => {
    const report = { MIT: [{ name: 'zod', versions: ['3.0.0'] }] };
    expect(reviewLicences(report)).toEqual([]);
  });

  test('names the package, the version and the licence when one is not allowed', () => {
    const report = { 'GPL-3.0': [{ name: 'copyleft-thing', versions: ['1.2.3'] }] };
    expect(reviewLicences(report)).toEqual([
      {
        package: 'copyleft-thing',
        versions: ['1.2.3'],
        licence: 'GPL-3.0',
        reason: 'licence is not on the allowed list',
      },
    ]);
  });

  test('a package with no licence needs a person to look, and says so', () => {
    const report = { UNLICENSED: [{ name: 'mystery', versions: ['0.1.0'] }] };
    expect(reviewLicences(report)[0]?.reason).toContain('someone has to check');
  });

  test('reports every offending package, not just the first', () => {
    const report = {
      'GPL-3.0': [
        { name: 'b', versions: ['1'] },
        { name: 'a', versions: ['1'] },
      ],
      MIT: [{ name: 'fine', versions: ['1'] }],
    };
    expect(reviewLicences(report).map((problem) => problem.package)).toEqual(['a', 'b']);
  });
});
