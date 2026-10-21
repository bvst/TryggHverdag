/**
 * The display-name rule (GRP-01-AC31, review loop 1; approach item 12): a name
 * a person can see, and nothing in it that changes how a name reads.
 *
 * The threat is spoofing (the abusive-member threat): a bidirectional control
 * such as U+202E makes a name read as someone else's, and a name of U+200B
 * alone shows as nothing in the admin's list. So a name, once trimmed, is:
 *   - 1 to 40 characters, counted by code point, as zod 4's `max` and the
 *     memberships table's `char_length` count them;
 *   - free of control characters (Unicode category Cc);
 *   - free of format characters (category Cf), the bidirectional controls
 *     among them, but for ZERO WIDTH NON-JOINER (U+200C) and ZERO WIDTH
 *     JOINER (U+200D), which real names and joined emoji need. Alone they
 *     cannot reverse a name, and a name of nothing else is refused below;
 *   - holding at least one visible character: one that is not white space
 *     (Unicode White_Space), not Cc or Cf (ZWNJ and ZWJ included: allowed,
 *     but not visible), and not one of the blank fillers U+115F, U+1160,
 *     U+3164, U+FFA0 and U+2800, letters that draw nothing.
 *
 * Written once, here, and read twice: the join's schema refuses such a name
 * with the fixed 400 (`groups.ts`), and the app checks a name with this same
 * function before it sends a join, so a refused name is never shown as a
 * refused invitation. The app reaches it through the package's
 * `./display-name` export, which is why this file imports nothing: the app's
 * bundler and its Jest load this file alone, not the contract's oRPC and zod.
 *
 * The memberships table's check stays looser (length and control characters
 * only, migration 0009): the join is the only way a name is written, and it
 * takes this rule. A check holding the Unicode categories would be read
 * against PostgreSQL's own Unicode tables, which need not match Node's.
 */

/** The longest display name, in characters, after trimming. */
export const MAX_DISPLAY_NAME_LENGTH = 40;

/** ZWNJ and ZWJ: the only format characters a name may hold. */
const ALLOWED_FORMAT_CHARACTERS: readonly string[] = ['‌', '‍'];

/** Letters that draw nothing: the Hangul fillers, the halfwidth one, and the braille blank. */
const BLANK_FILLERS: readonly string[] = ['ᅟ', 'ᅠ', 'ㅤ', 'ﾠ', '⠀'];

const CONTROL = /^\p{Cc}$/u;
const FORMAT = /^\p{Cf}$/u;
const WHITE_SPACE = /^\p{White_Space}$/u;

/**
 * Whether this name, as typed, may be a member's display name. Trimmed as
 * `String.prototype.trim` trims, as the join's schema trims it. Never throws.
 */
export function isUsableDisplayName(typed: string): boolean {
  const characters = Array.from(typed.trim());
  if (characters.length < 1 || characters.length > MAX_DISPLAY_NAME_LENGTH) {
    return false;
  }
  let visible = false;
  for (const character of characters) {
    if (CONTROL.test(character)) {
      return false;
    }
    if (FORMAT.test(character)) {
      if (!ALLOWED_FORMAT_CHARACTERS.includes(character)) {
        return false;
      }
    } else if (!WHITE_SPACE.test(character) && !BLANK_FILLERS.includes(character)) {
      visible = true;
    }
  }
  return visible;
}
