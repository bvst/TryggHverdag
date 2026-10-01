// req-coverage: fixtures-only — this tests the test kit, not a requirement.
//
// Every journey test takes its IDs and credentials from here. A builder that
// handed out the same value twice would let two "different" walkers share a
// journey without anyone noticing, and one whose shape differed from the real
// thing would let the server tell test data from real data by its form.
import { describe, expect, test } from 'vitest';
import * as kit from './index.ts';
import { CREDENTIAL_BYTES, syntheticCredential, syntheticUuid } from './synthetic-ids.ts';

/** RFC 9562: version 4 in the version nibble, the RFC variant in the next group. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * 32 bytes in base64url without padding: 43 characters, and the last one
 * carries only four bits, so it is one of these sixteen. Anything else would
 * be a string no real credential can be.
 */
const BASE64URL_43 = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;

const MANY = 500;

describe('syntheticUuid', () => {
  test('is a version-4 UUID, as the server stores', () => {
    for (let i = 0; i < MANY; i += 1) {
      expect(syntheticUuid()).toMatch(UUID_V4);
    }
  });

  test('never repeats itself', () => {
    const made = Array.from({ length: MANY }, () => syntheticUuid());

    expect(new Set(made).size).toBe(MANY);
  });

  test('is not the all-zeros UUID, which names nothing and would pass for a placeholder', () => {
    expect(syntheticUuid()).not.toBe('00000000-0000-0000-0000-000000000000');
  });
});

describe('syntheticCredential', () => {
  test('has the real credential’s shape: 32 bytes, base64url without padding', () => {
    expect(CREDENTIAL_BYTES).toBe(32);
    for (let i = 0; i < MANY; i += 1) {
      expect(syntheticCredential()).toMatch(BASE64URL_43);
    }
  });

  test('never repeats itself', () => {
    const made = Array.from({ length: MANY }, () => syntheticCredential());

    expect(new Set(made).size).toBe(MANY);
  });

  test('varies in every position, so no part of it is a fixed prefix a scan could key on', () => {
    const made = Array.from({ length: MANY }, () => syntheticCredential());

    for (let position = 0; position < 43; position += 1) {
      const seen = new Set(made.map((credential) => credential.charAt(position)));
      expect(seen.size, `position ${String(position)}`).toBeGreaterThan(1);
    }
  });
});

describe('the test kit', () => {
  test('hands out both builders', () => {
    expect(kit.syntheticUuid).toBe(syntheticUuid);
    expect(kit.syntheticCredential).toBe(syntheticCredential);
  });
});
