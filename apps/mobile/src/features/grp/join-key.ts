/**
 * The join key (GRP-01, approach item 4): 32 random bytes the app makes once,
 * as base64url, kept in secure storage and sent with every join. A join whose
 * answer was lost is sent again with the same key, and the server takes it as
 * the same join retried, not a second use of the invitation (F2).
 */
import { getRandomBytesAsync } from 'expo-crypto';

/** How many random bytes a join key is: 256 bits, as a device credential is (D-091). */
const JOIN_KEY_BYTES = 32;

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Bytes as base64url, with no padding: 32 bytes are 43 characters. */
export function base64url(bytes: Uint8Array): string {
  let out = '';
  for (let at = 0; at < bytes.length; at += 3) {
    const [a = 0, b = 0, c = 0] = [bytes[at], bytes[at + 1], bytes[at + 2]];
    const chunk = (a << 16) | (b << 8) | c;
    const left = bytes.length - at;
    out += BASE64URL.charAt((chunk >> 18) & 63) + BASE64URL.charAt((chunk >> 12) & 63);
    if (left > 1) {
      out += BASE64URL.charAt((chunk >> 6) & 63);
    }
    if (left > 2) {
      out += BASE64URL.charAt(chunk & 63);
    }
  }
  return out;
}

/** A new join key, from the platform's secure random source. */
export async function makeJoinKey(): Promise<string> {
  return base64url(await getRandomBytesAsync(JOIN_KEY_BYTES));
}
