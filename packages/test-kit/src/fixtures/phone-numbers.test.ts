// req-coverage: fixtures-only — this tests the test kit, not a requirement.
//
// GRP-02, CALL-01 and CALL-02's tests take every number from the fixtures
// file. If a fixture lost its shape, the test that uses it would prove
// nothing: a "number of exactly fifteen digits" with fourteen, a mobile
// number that was an emergency number. And the one number an L7 flow types
// on the emulator must stay in Ofcom's range reserved for drama, never a
// Norwegian or an emergency number (SPIKE-01-AC10's rule).
import { describe, expect, test } from 'vitest';
import * as numbers from './phone-numbers.ts';

/** Every emergency number CALL-01's approach 2 names, and the prefixes it sends to the dialer. */
const EMERGENCY = ['112', '911', '110', '113', '000', '08', '118', '119', '999'];
const EMERGENCY_PREFIXES = ['110', '112', '113', '000', '118', '119'];

describe('the phone-number fixtures', () => {
  test('each has the shape its name says', () => {
    expect(numbers.MOBILE).toMatch(/^[49]\d{7}$/);
    expect(numbers.OTHER_MOBILE).toMatch(/^[49]\d{7}$/);
    expect(numbers.OTHER_MOBILE).not.toBe(numbers.MOBILE);
    expect(numbers.MOBILE_WITH_112_INSIDE).toMatch(/^\d{3}112\d{2}$/);
    expect(numbers.MOBILE_BEGINNING_911).toMatch(/^911\d{5}$/);
    expect(numbers.MOBILE_BEGINNING_999).toMatch(/^999\d{5}$/);
    expect(numbers.FIVE_DIGIT_SPECIAL).toMatch(/^08\d{3}$/);
    expect(numbers.THREE_DIGITS).toMatch(/^\d{3}$/);
    expect(numbers.TWO_DIGITS).toMatch(/^\d{2}$/);
    expect(numbers.FIFTEEN_DIGITS).toMatch(/^\d{15}$/);
    expect(numbers.SIXTEEN_DIGITS).toMatch(/^\d{16}$/);
    expect(numbers.FOREIGN_TYPED.replace(/\s/g, '')).toBe(numbers.FOREIGN_NORMALISED);
    expect(numbers.FOREIGN_NORMALISED).toMatch(/^\+(?!47)\d{8,14}$/);
    expect([numbers.NORWAY_PLUS, numbers.NORWAY_ZEROS]).toEqual(['+47', '0047']);
  });

  test('no plain fixture is an emergency number or begins with one the dialer rule sends to the dialer', () => {
    const plain = [
      numbers.MOBILE,
      numbers.OTHER_MOBILE,
      numbers.MOBILE_WITH_112_INSIDE,
      numbers.THREE_DIGITS,
      numbers.FIFTEEN_DIGITS,
      numbers.SIXTEEN_DIGITS,
      numbers.FOREIGN_NORMALISED.slice(1),
    ];

    for (const number of plain) {
      expect({ number, emergency: EMERGENCY.includes(number) }).toEqual({
        number,
        emergency: false,
      });
      expect({
        number,
        prefixed: EMERGENCY_PREFIXES.some((prefix) => number.startsWith(prefix)),
      }).toEqual({ number, prefixed: false });
    }
  });

  test('the number an L7 flow types is in Ofcom’s range reserved for drama, +44 7700 900000 to 900999, and is typed as a person types it', () => {
    const { name, typed, normalised } = numbers.EMULATOR_FIRST_CONTACT;

    expect(normalised).toMatch(/^\+447700900\d{3}$/);
    expect(typed.replace(/\s/g, '')).toBe(normalised);
    expect(typed).toMatch(/\s/);
    expect(name.trim()).toBe(name);
    expect(name.length).toBeLessThanOrEqual(8);
  });

  test('the names are synthetic, distinct, and within the display-name rule’s 40 characters', () => {
    expect(numbers.FIRST_CONTACT_NAME).not.toBe(numbers.OTHER_FIRST_CONTACT_NAME);
    for (const name of [numbers.FIRST_CONTACT_NAME, numbers.OTHER_FIRST_CONTACT_NAME]) {
      expect(name).toMatch(/^Testkontakt /);
      expect(name.length).toBeLessThanOrEqual(40);
    }
  });
});
