// L2: the invitation code's issuer, in process, with node:crypto watched
// (GRP-01-AC1, approach item 3).
//
// An invitation code is 20 of Crockford's base32 characters, 100 bits, "from
// crypto.randomBytes", and only its SHA-256 is stored. Here the issuer is held
// to its source: randomBytes is asked, and with the bytes it gives fixed, the
// code follows them, so nothing else, Math.random above all, can choose it.
// The storing of its hash is proven at L3, by the shared group suite.
//
// node:crypto is mocked with itself, randomBytes wrapped in a spy that calls
// the real one unless a test fixes what it gives back, so both a named import
// and the default one reach the spy.
import { INVITATION_CODE } from '@trygghverdag/test-kit';
import { Buffer } from 'node:buffer';
// Loaded here, so the mock below is made and its spy is there to read and
// fix whether or not the issuer imports node:crypto at all: an issuer that
// never asks it then fails these tests on what it returns, not on a missing spy.
import 'node:crypto';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { issueInvitationCode } from './groups.ts';

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

describe('GRP-01-AC1: the invitation code comes from crypto.randomBytes', () => {
  test('GRP-01-AC1: issueInvitationCode asks crypto.randomBytes, and its code is 20 of Crockford’s characters', () => {
    const code = issueInvitationCode();

    expect(randomBytes.spy).toHaveBeenCalled();
    expect(code).toMatch(INVITATION_CODE);
  });

  test('GRP-01-AC1: the code follows the bytes: all zero bits give twenty 0s, all one bits twenty Zs, so nothing but randomBytes chooses it', () => {
    randomBytes.spy.mockImplementation((size: number) => Buffer.alloc(size, 0));
    const zeros = issueInvitationCode();
    randomBytes.spy.mockImplementation((size: number) => Buffer.alloc(size, 0xff));
    const ones = issueInvitationCode();

    expect(zeros).toBe('0'.repeat(20));
    expect(ones).toBe('Z'.repeat(20));
  });

  test('GRP-01-AC1: a thousand codes issued are a thousand different codes, every one well-formed', () => {
    const codes = Array.from({ length: 1_000 }, () => issueInvitationCode());

    expect(new Set(codes).size).toBe(1_000);
    for (const code of codes) {
      expect(code).toMatch(INVITATION_CODE);
    }
  });
});
