// req-coverage: fixtures-only — this tests the test kit, not a requirement.
//
// The fakes keep what the adapters keep of a credential, an invitation code
// and a join key: its SHA-256 (D-091, GRP-01). A digest that differed from
// the adapter's would let a system test pass against a fake that keeps
// something the database never would. Held here to the published test
// vectors (FIPS 180-4's examples, and the NIST/Wikipedia ones for the empty
// text and a multi-block message); the server's tests hold it to
// hashCredential, which is Node's.
import { describe, expect, test } from 'vitest';
import { sha256Hex } from './sha256.ts';

describe('sha256Hex', () => {
  test.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
    [
      'The quick brown fox jumps over the lazy dog',
      'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592',
    ],
  ])('matches the published digest of %j', (text, digest) => {
    expect(sha256Hex(text)).toBe(digest);
  });

  test('a million a’s, the long FIPS 180-4 example, spanning thousands of blocks', () => {
    expect(sha256Hex('a'.repeat(1_000_000))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    );
  });

  test('encodes as UTF-8 before hashing, as Node’s createHash(…).update(text, "utf8") does', () => {
    // Read from Node 22's own digest of the same texts: "æøå" is six bytes,
    // c3 a6 c3 b8 c3 a5; the second text holds a letter outside ASCII, an
    // astral character (a surrogate pair) and a lone surrogate, which Node
    // encodes as U+FFFD.
    expect(sha256Hex('æøå')).toBe(
      '6c228cdba89548a1af198f33819536422fb01b66e51f761cf2ec38d1fb4178a6',
    );
    expect(sha256Hex('Ø\u{1F600}\ud800x')).toBe(
      'c7f6a40422c41592c005963cda16b1c1481eb79820634d4deff9d33eb10c2123',
    );
  });

  test('is 64 lower-case hex digits, and differs for texts that differ by one character', () => {
    const one = sha256Hex('ABCDE-FGHJK-MNPQR-STVWX');
    const two = sha256Hex('ABCDE-FGHJK-MNPQR-STVWY');

    expect(one).toMatch(/^[0-9a-f]{64}$/);
    expect(two).toMatch(/^[0-9a-f]{64}$/);
    expect(one).not.toBe(two);
  });
});
