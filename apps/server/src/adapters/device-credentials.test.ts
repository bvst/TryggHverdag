// L2: the device credential's issuer, in process, with node:crypto watched
// (GRP-01-AC7; D-091). The invitation code's issuer is held the same way in
// adapters/groups.test.ts (GRP-01-AC1).
//
// D-091: "The issuer must use crypto.randomBytes(32), with a test asserting
// it. The plain-SHA-256 premise rests on 256 bits." This is that test. The
// credential is the base64url of exactly the 32 bytes randomBytes gave, 43
// characters, and what the database keeps is its SHA-256, hashCredential's.
// node:crypto is mocked with itself, randomBytes wrapped in a spy that calls
// the real one unless a test fixes what it gives back, so both a named import
// and the default one reach the spy.
import { sha256Hex, fc, syntheticCredential } from '@trygghverdag/test-kit';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { hashCredential, issueCredential } from './device-credentials.ts';

const randomBytes = vi.hoisted(() => ({ spy: undefined as unknown as ReturnType<typeof vi.fn> }));

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  const spy = vi.fn((size: number): Buffer => actual.randomBytes(size));
  randomBytes.spy = spy;
  return { ...actual, randomBytes: spy, default: { ...actual, randomBytes: spy } };
});

// mockReset, not mockClear: a test's fixed answer, used or not, never
// reaches the next test; the spy calls the real randomBytes again.
afterEach(() => {
  randomBytes.spy.mockReset();
});

/** The sizes randomBytes was asked for, in order. */
const sizesAsked = (): unknown[] => randomBytes.spy.mock.calls.map(([size]) => size as unknown);

describe('GRP-01-AC7: the device credential is 256 random bits, kept only as a hash', () => {
  test('GRP-01-AC7: issueCredential takes exactly 32 bytes from crypto.randomBytes, once, and nothing else (D-091)', () => {
    issueCredential();

    expect(sizesAsked()).toEqual([32]);
  });

  test('GRP-01-AC7: the credential is the base64url of exactly the bytes randomBytes gave, 43 characters, and the hash is its SHA-256, hashCredential’s', () => {
    issueCredential();
    const given = randomBytes.spy.mock.results[0]?.value as Buffer;

    const fixed = Buffer.alloc(32, 0xa5);
    randomBytes.spy.mockReturnValueOnce(fixed);
    const issued = issueCredential();

    expect(given).toBeInstanceOf(Buffer);
    expect(issued.credential).toBe(fixed.toString('base64url'));
    expect(issued.credential).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued.hash).toBe(hashCredential(issued.credential));
    expect(issued.hash).toBe(createHash('sha256').update(issued.credential, 'utf8').digest('hex'));
    expect(issued.hash).not.toContain(issued.credential);
  });

  test('GRP-01-AC7: two credentials issued are two, each with its own hash', () => {
    const first = issueCredential();
    const second = issueCredential();

    expect(second.credential).not.toBe(first.credential);
    expect(second.hash).not.toBe(first.hash);
    expect(sizesAsked()).toEqual([32, 32]);
  });

  test('GRP-01-AC7: with randomBytes failing, no credential is issued: the failure is thrown, never a weaker credential made some other way', () => {
    randomBytes.spy.mockImplementationOnce(() => {
      throw new Error('the entropy source is gone');
    });

    expect(() => issueCredential()).toThrow('the entropy source is gone');
  });
});

describe('what the fakes keep is what the adapter keeps', () => {
  test('the test kit’s SHA-256, which the fakes keep of credentials, codes and join keys, is hashCredential’s, for any text', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string({ unit: 'binary' }), fc.constant(syntheticCredential())),
        (text) => {
          expect(sha256Hex(text)).toBe(hashCredential(text));
        },
      ),
      { numRuns: 500 },
    );
  });
});
