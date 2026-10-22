// GRP-02-AC3 (L5, table-driven): #1 can be any phone number, and only a phone
// number. The rule is a pure function in features/grp/first-contact.ts
// (GRP-02, approach 3):
//   - whitespace (JavaScript's \s), hyphens, full stops and parentheses are
//     dropped, and nothing else is changed: no country code is added, removed
//     or rewritten, so a number typed with 0047 keeps it;
//   - what is left must be an optional + as its first character, then the
//     digits 0 to 9 only, 3 to 15 of them (E.164's longest; 3 lets a short
//     service number through);
//   - anything else is refused, and nothing is saved.
//
// The function's name and shape are fixed here, for the screen and this test
// to share: `normaliseNumber(typed)` gives the number in its normalised form,
// or null when the rule refuses it.
//
// This file is named .tsx, though it holds no JSX, on purpose. The app's
// tsconfig reads every src/**/*.ts before any .tsx, and a .ts test that sorts
// before features/grp/index.ts and imports @jest/globals first changes how
// TypeScript types process.env across the whole app (two @types/node
// versions, 22 and 26, meet there): lint then calls the casts in
// shared/api/client.ts, app.config.ts and app.config.test.ts unnecessary.
// As .tsx it is read after them, as grp.test.tsx is, and changes nothing.
//
// The module is loaded in each test, so each reports its own failure while it
// does not exist yet, rather than the whole file failing to load.
//
// Every number is synthetic, from the test kit's fixtures (RG-07, HK-07),
// built into the shapes the spec lists at run time; `d` in a name below is any
// digit. 110, 112 and 113 appear only where the rule is about them: the rule
// does not refuse an emergency number, because the walker chooses whom they
// call first, and the call button keeps it away from ACTION_CALL (CALL-01,
// approach 2).
import { describe, expect, jest, test } from '@jest/globals';

import {
  FIFTEEN_DIGITS,
  FOREIGN_NORMALISED,
  FOREIGN_TYPED,
  MOBILE,
  NORWAY_PLUS,
  NORWAY_ZEROS,
  SIXTEEN_DIGITS,
  THREE_DIGITS,
  TWO_DIGITS,
} from '../../../../../packages/test-kit/src/fixtures/phone-numbers.ts';

/** The rule, as features/grp/first-contact.ts exports it. */
interface FirstContactRule {
  normaliseNumber: (typed: string) => string | null;
}

/** The rule's module, loaded afresh, so a missing module fails each test on its own. */
function rule(): FirstContactRule {
  const loaded: FirstContactRule = jest.requireActual('./first-contact');
  return loaded;
}

/** `eight` as `ddd dd ddd`, with `between` between the groups. */
const grouped = (eight: string, between = ' '): string =>
  [eight.slice(0, 3), eight.slice(3, 5), eight.slice(5)].join(between);

/** Numbers the rule takes, as typed, and as it gives them back. */
const ACCEPTED: [string, string, string][] = [
  ['ddd dd ddd: the eight digits', grouped(MOBILE), MOBILE],
  ['dddddddd as it is', MOBILE, MOBILE],
  [
    '+47 ddd-dd-ddd: +47 and the eight digits',
    `${NORWAY_PLUS} ${grouped(MOBILE, '-')}`,
    `${NORWAY_PLUS}${MOBILE}`,
  ],
  [
    '0047 (ddd) dd.ddd: 0047, kept, and the eight digits',
    `${NORWAY_ZEROS} (${MOBILE.slice(0, 3)}) ${MOBILE.slice(3, 5)}.${MOBILE.slice(5)}`,
    `${NORWAY_ZEROS}${MOBILE}`,
  ],
  ['a +, a foreign country code and a number', FOREIGN_TYPED, FOREIGN_NORMALISED],
  ['exactly 3 digits', THREE_DIGITS, THREE_DIGITS],
  ['exactly 15 digits', FIFTEEN_DIGITS, FIFTEEN_DIGITS],
  ['a + and exactly 15 digits', `+${FIFTEEN_DIGITS}`, `+${FIFTEEN_DIGITS}`],
  ['a + and exactly 3 digits', `+${THREE_DIGITS}`, `+${THREE_DIGITS}`],
  [
    'a tab and a no-break space, both \\s',
    `${MOBILE.slice(0, 4)}\t${MOBILE.slice(4, 6)}\u00a0${MOBILE.slice(6)}`,
    MOBILE,
  ],
  ['white space before the +', `  ${NORWAY_PLUS}${MOBILE}  `, `${NORWAY_PLUS}${MOBILE}`],
  [
    'separators of every kind together',
    `(${MOBILE.slice(0, 2)}).${MOBILE.slice(2, 4)}-${MOBILE.slice(4)} `,
    MOBILE,
  ],
];

/** Numbers the rule refuses, as typed. */
const REFUSED: [string, string][] = [
  ['an empty field', ''],
  ['only whitespace', ' \t '],
  ['a letter at the start', `A${MOBILE}`],
  ['a letter inside', `${MOBILE.slice(0, 4)}b${MOBILE.slice(4)}`],
  ['a letter at the end', `${MOBILE}x`],
  ['a star', `*${MOBILE}`],
  ['a hash', `${MOBILE}#`],
  ['a comma', `${MOBILE.slice(0, 4)},${MOBILE.slice(4)}`],
  ['a semicolon', `${MOBILE};${THREE_DIGITS}`],
  ['a slash', `${MOBILE.slice(0, 4)}/${MOBILE.slice(4)}`],
  ['an underscore', `${MOBILE.slice(0, 4)}_${MOBILE.slice(4)}`],
  ['a left-to-right mark (U+200E), which is not whitespace', `\u200e${MOBILE}`],
  ['Arabic-Indic digits', '٩٠٣٧٤٨١٥'],
  ['full-width digits', '９０３７４８１５'],
  ['a + not first', `${MOBILE.slice(0, 2)}+${MOBILE.slice(2)}`],
  ['a + at the end', `${MOBILE}+`],
  ['two +', `++${MOBILE}`],
  ['a + and nothing else', '+'],
  ['2 digits', TWO_DIGITS],
  ['a + and 2 digits', `+${TWO_DIGITS}`],
  ['16 digits', SIXTEEN_DIGITS],
  ['a + and 16 digits', `+${SIXTEEN_DIGITS}`],
];

describe('GRP-02-AC3: the number rule, features/grp/first-contact.ts', () => {
  test.each(ACCEPTED)('GRP-02-AC3: accepts %s', (_shape, typed, normalised) => {
    expect(rule().normaliseNumber(typed)).toBe(normalised);
  });

  test.each(REFUSED)('GRP-02-AC3: refuses %s', (_shape, typed) => {
    expect(rule().normaliseNumber(typed)).toBeNull();
  });

  test('GRP-02-AC3: never adds, removes or rewrites a country code: +47 stays +47, 0047 stays 0047, and none is added', () => {
    const { normaliseNumber } = rule();

    expect(normaliseNumber(`${NORWAY_PLUS}${MOBILE}`)).toBe(`${NORWAY_PLUS}${MOBILE}`);
    expect(normaliseNumber(`${NORWAY_ZEROS}${MOBILE}`)).toBe(`${NORWAY_ZEROS}${MOBILE}`);
    expect(normaliseNumber(MOBILE)).toBe(MOBILE);
  });

  test('GRP-02-AC3: does not refuse 110, 112 or 113: the walker chooses whom they call first, and the call button sends an emergency number to the dialer (CALL-01, approach 2)', () => {
    const { normaliseNumber } = rule();

    for (const emergency of ['110', '112', '113']) {
      expect(normaliseNumber(emergency)).toBe(emergency);
      expect(normaliseNumber(`${NORWAY_PLUS} ${emergency}`)).toBe(`${NORWAY_PLUS}${emergency}`);
    }
  });

  test('GRP-02-AC3: what it gives back always passes the rule again unchanged, and is a + then digits only', () => {
    const { normaliseNumber } = rule();

    for (const [, typed] of ACCEPTED) {
      const once = normaliseNumber(typed);
      expect(once).toMatch(/^\+?[0-9]{3,15}$/);
      expect(normaliseNumber(once ?? '')).toBe(once);
    }
  });
});
