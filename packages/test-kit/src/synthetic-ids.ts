/**
 * Synthetic IDs and device credentials, made fresh on every run (RG-07).
 *
 * The repository is public (D-089), and gitleaks and the write-time scan read
 * every committed line. So no test writes an ID or a credential out as text:
 * it asks for one here, and gets a value nobody has ever held. Random rather
 * than counted, so two tests that share one database cannot collide by both
 * starting from the same number.
 *
 * `Math.random`, not a CSPRNG: these values guard nothing. What matters is
 * that each has exactly the shape of the real thing, so the code under test
 * cannot tell a synthetic value from a real one by its form. The test kit has
 * no Node types (it is meant to stay usable from the app), so `node:crypto`
 * is not an option here anyway.
 */

const HEX = '0123456789abcdef';
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** How many random bytes a device credential holds: 256 bits, as the server issues. */
export const CREDENTIAL_BYTES = 32;

function randomBelow(limit: number): number {
  return Math.floor(Math.random() * limit);
}

function hex(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += HEX.charAt(randomBelow(16));
  }
  return out;
}

/** A random version-4 UUID, the shape of every ID the server stores. */
export function syntheticUuid(): string {
  const variant = '89ab'.charAt(randomBelow(4));
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${variant}${hex(3)}-${hex(12)}`;
}

/**
 * A device credential with the real one's shape: CREDENTIAL_BYTES random
 * bytes, base64url-encoded without padding, so 43 characters.
 */
export function syntheticCredential(): string {
  const bytes = Array.from({ length: CREDENTIAL_BYTES }, () => randomBelow(256));
  return base64url(bytes);
}

/** RFC 4648 §5, without padding. */
function base64url(bytes: readonly number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const first = bytes[i] ?? 0;
    const second = bytes[i + 1];
    const third = bytes[i + 2];
    const group = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    out += BASE64URL.charAt((group >> 18) & 63) + BASE64URL.charAt((group >> 12) & 63);
    if (second !== undefined) {
      out += BASE64URL.charAt((group >> 6) & 63);
    }
    if (third !== undefined) {
      out += BASE64URL.charAt(group & 63);
    }
  }
  return out;
}
