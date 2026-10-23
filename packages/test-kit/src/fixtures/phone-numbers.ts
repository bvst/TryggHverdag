/**
 * Phone numbers and names for tests, every one invented (RG-07): the one file
 * the sensitive-data hook (HK-07) lets hold numbers that look Norwegian.
 *
 * GRP-02, CALL-01 and CALL-02 (M3 task 2) take every number from here, in the
 * app's jest tests and in the L7 script alike, so no second copy of a number
 * is written anywhere: a test that needs a number in another shape, spaced or
 * with a country code in front, builds it from these digits at run time.
 *
 * Two kinds, kept apart on purpose:
 *   - numbers shaped as Norwegian ones, for L5 tests, where the phone module
 *     is a fake and nothing is ever dialled. They have the shapes the specs
 *     list (GRP-02-AC3, CALL-01-AC2), and are nobody's that we know of; they
 *     must never reach a real phone or an emulator;
 *   - EMULATOR_FIRST_CONTACT, from Ofcom's range reserved for drama (07700
 *     900000 to 900999, so +44 7700 900nnn), as SPIKE-01's S6 dialled: the one
 *     number an L7 flow may type and call on the emulator, which has no
 *     network and reaches no one (CALL-01's test plan).
 *
 * None of them is 112 or any other emergency number. A test about emergency
 * numbers (CALL-01-AC2, CALL-02) writes those itself, because they are the
 * subject of the test, and never dials them (SPIKE-01-AC10's rule).
 */

/** Eight digits, the shape of a Norwegian mobile number (blocks 40 to 49 and 90 to 99). */
export const MOBILE = '90374815';

/** Another, for a #1 that is changed (GRP-02-AC5). */
export const OTHER_MOBILE = '41528936';

/** Eight digits with 112 inside them, `ddd112dd`: no emergency number (CALL-01-AC2). */
export const MOBILE_WITH_112_INSIDE = '94711238';

/** A mobile number that begins with 911, `911ddddd`: a real shape, so it calls on the tap (CALL-01-AC2). */
export const MOBILE_BEGINNING_911 = '91147302';

/** A mobile number that begins with 999, `999ddddd`: a real shape too (CALL-01-AC2). */
export const MOBILE_BEGINNING_999 = '99918465';

/** A five-digit special number, `08ddd` (Nkom's 02000 to 09999): a real shape (CALL-01-AC2). */
export const FIVE_DIGIT_SPECIAL = '08417';

/** A number of exactly three digits, the shortest the number rule takes, and no emergency number (GRP-02-AC3). */
export const THREE_DIGITS = '123';

/** Two digits: one short of the rule (GRP-02-AC3). */
export const TWO_DIGITS = '12';

/** Exactly fifteen digits, E.164's longest (GRP-02-AC3). */
export const FIFTEEN_DIGITS = '447700900123456';

/** Sixteen digits: one past E.164's longest (GRP-02-AC3). */
export const SIXTEEN_DIGITS = '4477009001234567';

/** A foreign number with its country code, as typed: Ofcom's drama range, with spaces (GRP-02-AC3). */
export const FOREIGN_TYPED = '+44 7700 900123';

/** The same, normalised: what the app stores, shows and dials. */
export const FOREIGN_NORMALISED = '+447700900123';

/** Norway's country code, written the two ways a person types it in front of a number. */
export const NORWAY_PLUS = '+47';
export const NORWAY_ZEROS = '0047';

/** A synthetic #1's name, with a Norwegian letter. */
export const FIRST_CONTACT_NAME = 'Testkontakt Åsmund';

/** Another, for a #1 that is changed (GRP-02-AC5). */
export const OTHER_FIRST_CONTACT_NAME = 'Testkontakt Bølgen';

/**
 * The #1 an L7 flow chooses and calls on the emulator: a short synthetic name,
 * so the call button's text fits at the largest font size (CALL-01-AC8), and a
 * number from Ofcom's range reserved for drama, typed with spaces as a person
 * types one, and normalised as the app shows and dials it.
 */
export const EMULATOR_FIRST_CONTACT = {
  name: 'Testa',
  typed: '+44 7700 900318',
  normalised: '+447700900318',
} as const;
