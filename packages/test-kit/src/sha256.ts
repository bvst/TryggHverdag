/**
 * SHA-256, text in and lower-case hex out: what the server keeps of a device
 * credential, an invitation code and a join key (D-091, GRP-01, approach items
 * 3 and 4), worked out the same way here so the fakes keep exactly what the
 * adapters keep.
 *
 * Written out rather than imported because the test kit has no Node types
 * (it is meant to stay usable from the app), so `node:crypto` is not an
 * option, and the fakes answer synchronously, so Web Crypto's promise is not
 * either. The text is encoded as UTF-8 first, as `createHash(...).update(text,
 * 'utf8')` encodes it. Its own test holds it to the published test vectors,
 * and the server's tests hold it to `hashCredential`.
 *
 * Guards nothing: the fakes only need the same digest as the adapter.
 */

/** The first `count` primes. */
function primes(count: number): number[] {
  const found: number[] = [];
  for (let candidate = 2; found.length < count; candidate += 1) {
    if (found.every((prime) => candidate % prime !== 0)) {
      found.push(candidate);
    }
  }
  return found;
}

/** The first 32 bits of the fractional part of x, as FIPS 180-4 takes its constants. */
function fractionBits(x: number): number {
  return ((x - Math.floor(x)) * 0x100000000) >>> 0;
}

const PRIMES = primes(64);
/** FIPS 180-4 §4.2.2: from the cube roots of the first 64 primes. */
const K = PRIMES.map((prime) => fractionBits(Math.cbrt(prime)));
/** FIPS 180-4 §5.3.3: from the square roots of the first 8 primes. */
const INITIAL = PRIMES.slice(0, 8).map((prime) => fractionBits(Math.sqrt(prime)));

/** Read past the end, as nothing here ever does, it is 0: noUncheckedIndexedAccess's due. */
function at(values: readonly number[], index: number): number {
  return values[index] ?? 0;
}

function rotateRight(value: number, by: number): number {
  return ((value >>> by) | (value << (32 - by))) >>> 0;
}

/** The text's UTF-8 bytes, a lone surrogate as U+FFFD, as Node's encoder writes it. */
function utf8(text: string): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    let code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        index += 1;
      } else {
        code = 0xfffd;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      code = 0xfffd;
    }
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return bytes;
}

/** The SHA-256 of `text`, encoded as UTF-8, as 64 lower-case hex digits. */
export function sha256Hex(text: string): string {
  const bytes = utf8(text);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) {
    bytes.push(0);
  }
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  for (const word of [high, low]) {
    bytes.push((word >>> 24) & 0xff, (word >>> 16) & 0xff, (word >>> 8) & 0xff, word & 0xff);
  }

  const hash = [...INITIAL];
  const schedule = new Array<number>(64).fill(0);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      const start = offset + i * 4;
      schedule[i] =
        ((at(bytes, start) << 24) |
          (at(bytes, start + 1) << 16) |
          (at(bytes, start + 2) << 8) |
          at(bytes, start + 3)) >>>
        0;
    }
    for (let i = 16; i < 64; i += 1) {
      const before15 = at(schedule, i - 15);
      const before2 = at(schedule, i - 2);
      const s0 = rotateRight(before15, 7) ^ rotateRight(before15, 18) ^ (before15 >>> 3);
      const s1 = rotateRight(before2, 17) ^ rotateRight(before2, 19) ^ (before2 >>> 10);
      schedule[i] = (at(schedule, i - 16) + s0 + at(schedule, i - 7) + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = [
      at(hash, 0),
      at(hash, 1),
      at(hash, 2),
      at(hash, 3),
      at(hash, 4),
      at(hash, 5),
      at(hash, 6),
      at(hash, 7),
    ];
    for (let i = 0; i < 64; i += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const first = (h + sum1 + choice + at(K, i) + at(schedule, i)) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const second = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + first) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (first + second) >>> 0;
    }
    for (const [index, value] of [a, b, c, d, e, f, g, h].entries()) {
      hash[index] = (at(hash, index) + value) >>> 0;
    }
  }
  return hash.map((word) => word.toString(16).padStart(8, '0')).join('');
}
