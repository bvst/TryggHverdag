/**
 * Synthetic group data for GRP-01 (RG-07): display names, invitation codes,
 * join keys and the first admin's bootstrap code, fresh on every run.
 *
 * Nobody's name is ever written out. A display name here is the word
 * "Testmedlem" and a random tag, so a log-capture test can search for each one
 * and never meet it by chance; it holds a letter outside ASCII, so a store or
 * a log that mishandled UTF-8 would show it. Codes and keys have exactly the
 * real ones' shapes, as synthetic-ids.ts makes credentials, so the code under
 * test cannot tell them apart by their form.
 *
 * `Math.random`, not a CSPRNG: these values guard nothing.
 */
import { syntheticCredential } from './synthetic-ids.ts';

/**
 * Crockford's base32 alphabet: digits, then the letters without I, L, O and U
 * (GRP-01, approach item 3). An invitation code is 20 of these.
 */
export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** An invitation code as the store keeps and hashes it: 20 of Crockford's characters, upper case, nothing between. */
export const INVITATION_CODE = /^[0-9A-HJKMNP-TV-Z]{20}$/;

/**
 * An invitation code as the API shows it (GRP-01-AC1): the same 20
 * characters in four groups of five, one separator between each, a hyphen or
 * a space, the same each time.
 */
export const SHOWN_INVITATION_CODE =
  /^[0-9A-HJKMNP-TV-Z]{5}([- ])[0-9A-HJKMNP-TV-Z]{5}\1[0-9A-HJKMNP-TV-Z]{5}\1[0-9A-HJKMNP-TV-Z]{5}$/;

/** A join key and a device credential alike: 32 bytes, base64url without padding, so 43 characters (D-091). */
export const BASE64URL_43 = /^[A-Za-z0-9_-]{43}$/;

const HEX_UPPER = '0123456789ABCDEF';
const TAG_LETTERS = 'ABCDEFGHJKMNPQRSTVWXYZÆØÅ';

function randomBelow(limit: number): number {
  return Math.floor(Math.random() * limit);
}

function randomOf(alphabet: string, length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += alphabet.charAt(randomBelow(alphabet.length));
  }
  return out;
}

/**
 * A display name a person might type, synthetic: "Testmedlem" and a tag of
 * six random letters, one of them always outside ASCII. 17 characters, inside
 * the 1 to 40 a membership allows (approach item 2).
 */
export function syntheticDisplayName(): string {
  const tag = randomOf(TAG_LETTERS, 5);
  return `Testmedlem Ø${tag}`;
}

/** An invitation code with the real one's shape: 20 of Crockford's characters, as the store keeps it. */
export function syntheticInvitationCode(): string {
  return randomOf(CROCKFORD_ALPHABET, 20);
}

/**
 * The first admin's bootstrap code with the real one's shape: Terraform's
 * `random_id` of 16 bytes, written as upper-case hex, 32 characters
 * (approach item 8). Every hex digit is one of Crockford's characters.
 */
export function syntheticBootstrapCode(): string {
  return randomOf(HEX_UPPER, 32);
}

/** A join key with the real one's shape: 32 random bytes, base64url, 43 characters (approach item 4). */
export function syntheticJoinKey(): string {
  return syntheticCredential();
}

/** The code in four groups of five, joined by `separator`, as the API shows it. */
export function inGroupsOfFive(code: string, separator = '-'): string {
  return [0, 5, 10, 15].map((start) => code.slice(start, start + 5)).join(separator);
}
