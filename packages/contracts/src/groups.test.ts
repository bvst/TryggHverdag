// L2 contract: the display-name rule a join is held to (GRP-01-AC31, review
// loop 1, privacy-security-reviewer N4: the abusive-member threat).
//
// The green head's rule (1 to 40 characters once trimmed, no control
// character) let through U+202E RIGHT-TO-LEFT OVERRIDE, which makes a name
// read as another, and a name of U+200B ZERO WIDTH SPACE alone, which shows
// as nothing in the admin's list. The rule now also refuses every
// bidirectional control and every other format character (Unicode category
// Cf) but ZWNJ (U+200C) and ZWJ (U+200D), which real names and joined emoji
// need, and a name with nothing visible in it: only white space, ZWNJ, ZWJ,
// or the blank fillers U+115F, U+1160, U+3164, U+FFA0 and U+2800.
//
// The rule is held here as the join's own schema applies it, a whole join
// with a well-formed code and join key and the name varied, so whatever the
// rule is called inside the contract, this is what the route takes. The
// property's model is the spec's sentence, written out: once trimmed (as
// String.prototype.trim trims, the green head's way), 1 to 40 characters as
// the green head counts them, which is by code point (zod 4's max, and the
// table's char_length: 40 astral characters pass, 41 do not), no Cc, no Cf
// but U+200C and U+200D, and at least one character that is not
// White_Space, Cc, Cf or a filler.
//
// This package may not depend on the test kit (the import rule
// contracts-depend-on-nothing-of-ours), so fast-check comes from its own
// devDependencies. Every name here is synthetic (RG-07): words that mean
// "test" or "member", never anyone's name.
import { randomBytes } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { joinRequestSchema } from './index.ts';

/**
 * A join key of the real one's shape: 32 random bytes as base64url, 43
 * characters (D-091). Made at run time, as SM-01's "Synthetic data only" asks:
 * no credential-looking literal is written in a file, because gitleaks (CI's
 * `security` job) reads every committed line. Made once, so it is fixed for
 * the run and every case below differs from the next by its name alone.
 */
const JOIN_KEY = randomBytes(32).toString('base64url');

/** A join that is otherwise valid: a code of the right shape and a join key of 43 base64url characters. */
const join = (displayName: string) => ({
  invitationCode: 'ABCDE-FGHJK-MNPQR-STVWX',
  joinKey: JOIN_KEY,
  displayName,
});

/** Whether the contract's rule takes this name, as the join's schema applies it. */
const accepts = (displayName: string): boolean =>
  joinRequestSchema.safeParse(join(displayName)).success;

/** The bidirectional controls AC31 names, one by one. */
const BIDI_CONTROLS = ['؜', '‎', '‏', '‪', '‫', '‬', '‭', '‮', '⁦', '⁧', '⁨', '⁩'];

/** The blank fillers AC31 names: letters that draw nothing. */
const FILLERS = ['ᅟ', 'ᅠ', 'ㅤ', 'ﾠ', '⠀'];

const ZWNJ = '‌';
const ZWJ = '‍';

const isCc = (character: string): boolean => /^\p{Cc}$/u.test(character);
const isCf = (character: string): boolean => /^\p{Cf}$/u.test(character);
const isWhiteSpace = (character: string): boolean => /^\p{White_Space}$/u.test(character);

/** The spec's rule, written out (approach item 12, AC31). */
function ruleAccepts(name: string): boolean {
  const characters = Array.from(name.trim());
  if (characters.length < 1 || characters.length > 40) {
    return false;
  }
  if (characters.some(isCc)) {
    return false;
  }
  if (characters.some((character) => isCf(character) && character !== ZWNJ && character !== ZWJ)) {
    return false;
  }
  return characters.some(
    (character) =>
      !isWhiteSpace(character) &&
      !isCc(character) &&
      !isCf(character) &&
      !FILLERS.includes(character),
  );
}

const hex = (text: string): string =>
  Array.from(text)
    .map(
      (character) =>
        `U+${(character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`,
    )
    .join(' ');

describe('GRP-01-AC31: the contract’s rule, by name', () => {
  test.each(BIDI_CONTROLS.map((control) => [hex(control), control]))(
    'GRP-01-AC31: a name holding the bidirectional control %s is refused',
    (_code, control) => {
      expect(accepts(`Test${control}medlem`)).toBe(false);
      expect(accepts(`Testmedlem${control}`)).toBe(false);
      expect(accepts(`${control}Testmedlem`)).toBe(false);
    },
  );

  test.each([
    ['U+200B ZERO WIDTH SPACE', '​'],
    ['U+FEFF ZERO WIDTH NO-BREAK SPACE', '﻿'],
    ['U+00AD SOFT HYPHEN', '­'],
  ])('GRP-01-AC31: a name holding %s, a format character, is refused', (_what, character) => {
    expect(accepts(`Test${character}medlem`)).toBe(false);
  });

  test('GRP-01-AC31: a name of U+200B alone, which shows as nothing in the admin’s list, is refused', () => {
    expect(accepts('​')).toBe(false);
    expect(accepts('​​​')).toBe(false);
  });

  test.each([
    ['spaces', '    '],
    ['a no-break space and an ideographic space', ' 　'],
    ['spaces of every width', '      '],
  ])('GRP-01-AC31: a name of white space only (%s) is refused', (_what, name) => {
    expect(accepts(name)).toBe(false);
  });

  test.each([
    ['ZWNJ alone', ZWNJ],
    ['ZWJ alone', ZWJ],
    ['ZWNJ and ZWJ, several', `${ZWNJ}${ZWJ}${ZWNJ}${ZWJ}`],
    ['ZWJ between spaces', ` ${ZWJ} `],
  ])(
    'GRP-01-AC31: a name of %s, allowed characters that are not visible, is refused',
    (_what, name) => {
      expect(accepts(name)).toBe(false);
    },
  );

  test.each(FILLERS.map((filler) => [hex(filler), filler]))(
    'GRP-01-AC31: a name of the blank filler %s alone, or with spaces and ZWJ, is refused',
    (_code, filler) => {
      expect(accepts(filler)).toBe(false);
      expect(accepts(`${filler}${filler}${filler}`)).toBe(false);
      expect(accepts(` ${filler}${ZWJ}${filler} `)).toBe(false);
    },
  );

  test.each([
    ['a Norwegian letter', 'Åse'],
    ['an apostrophe', "O'Brien"],
    ['a hyphen', 'Anne-Marit'],
    ['a space and digits', 'Testmedlem 2'],
    ['ZWNJ between two Latin letters', `Test${ZWNJ}medlem`],
    ['ZWNJ between two Persian letters', `آزمون${ZWNJ}نام`],
    ['an emoji family joined with ZWJ', `Testmedlem 👩${ZWJ}👩${ZWJ}👧`],
    ['an emoji joined with ZWJ, alone', `👩${ZWJ}💻`],
    ['Cyrillic', 'Тестовый'],
    ['Hangul', '테스트'],
    ['Japanese', 'テスト'],
    ['Arabic', 'اختبار'],
    ['Greek', 'Δοκιμή'],
    ['a letter with a combining accent', 'Testmedlém'],
    ['40 characters exactly', 'T'.repeat(40)],
    ['40 characters outside the basic plane, 80 UTF-16 units', '\u{1D54B}'.repeat(40)],
    ['a filler beside a letter', `Test${FILLERS[2] ?? ''}medlem`],
  ])('GRP-01-AC31: a name with %s is accepted', (_what, name) => {
    expect(accepts(name)).toBe(true);
  });

  test('GRP-01-AC31: the green head’s refusals stand: empty, 41 characters, a control character', () => {
    expect(accepts('')).toBe(false);
    expect(accepts('T'.repeat(41))).toBe(false);
    expect(accepts('\u{1D54B}'.repeat(41))).toBe(false);
    expect(accepts('Test\u0007medlem')).toBe(false);
    expect(accepts('Test\u0085medlem')).toBe(false);
  });
});

describe('GRP-01-AC31: the contract’s rule, for any string', () => {
  /** What the property draws from most: every character the rule names, and some it lets through. */
  const NAMED = [
    ...BIDI_CONTROLS,
    ...FILLERS,
    ZWNJ,
    ZWJ,
    '​',
    '﻿',
    '­',
    '᠎',
    '⁠',
    '؀',
    '\u{1D173}',
    '\u{E0001}',
    '\u{E0041}',
    ' ',
    ' ',
    '　',
    ' ',
    '\t',
    '\n',
    '\u0000',
    '\u001F',
    '\u007F',
    '\u0085',
    '\u009F',
  ];
  const VISIBLE = ['T', 'å', 'Ø', 'ß', "'", '-', '7', 'Д', '字', 'ب', '😀', '́', ''];

  const character = fc.oneof(
    { weight: 5, arbitrary: fc.constantFrom(...NAMED) },
    { weight: 4, arbitrary: fc.constantFrom(...VISIBLE) },
    { weight: 1, arbitrary: fc.string({ unit: 'binary', minLength: 1, maxLength: 1 }) },
  );
  const padding = fc.array(fc.constantFrom(' ', ' ', '　', '\t', '\n', '﻿'), {
    maxLength: 4,
  });
  const names = fc.oneof(
    // Short, built from the named characters: the rule's every branch.
    fc.array(character, { maxLength: 8 }).map((characters) => characters.join('')),
    // Around the length bound, with white space around it.
    fc
      .tuple(
        padding,
        fc.integer({ min: 36, max: 44 }),
        fc.array(character, { maxLength: 3 }),
        padding,
      )
      .map(
        ([before, length, inside, after]) =>
          `${before.join('')}${'T'.repeat(length - inside.length)}${inside.join('')}${after.join('')}`,
      ),
    // And any string at all.
    fc.string({ unit: 'binary', maxLength: 50 }),
  );

  test('GRP-01-AC31: the contract’s rule accepts a string exactly when, once trimmed, it is 1 to 40 characters, holds no Cc character, no Cf character but U+200C and U+200D, and at least one visible character; and it never throws', () => {
    fc.assert(
      fc.property(names, (name) => {
        // A throw here fails the property, naming the string that threw.
        const accepted = accepts(name);
        expect({ name: hex(name), accepted }).toEqual({
          name: hex(name),
          accepted: ruleAccepts(name),
        });
      }),
      { numRuns: 5_000 },
    );
  });

  test('GRP-01-AC31: the property is not vacuous: its strings reach every branch of the rule', () => {
    /** Which branch of the spec's rule decides this string. */
    const branchOf = (name: string): string => {
      const characters = Array.from(name.trim());
      if (characters.length < 1) {
        return 'empty';
      }
      if (characters.length > 40) {
        return 'too long';
      }
      if (characters.some(isCc)) {
        return 'Cc';
      }
      if (
        characters.some((character) => isCf(character) && character !== ZWNJ && character !== ZWJ)
      ) {
        return 'Cf';
      }
      return ruleAccepts(name) ? 'accepted' : 'nothing visible';
    };

    const reasons = new Set(fc.sample(names, { numRuns: 5_000, seed: 31 }).map(branchOf));

    expect([...reasons].sort()).toEqual(
      ['Cc', 'Cf', 'accepted', 'empty', 'nothing visible', 'too long'].sort(),
    );
  });
});
