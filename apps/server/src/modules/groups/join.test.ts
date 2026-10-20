// L2: the join module, in process, with node:crypto watched (GRP-01-AC8,
// review loop 1, privacy-security-reviewer N2).
//
// The first admin's bootstrap code opens an empty group, so how a code sent
// is compared with ADMIN_BOOTSTRAP_CODE matters: compared with `===`, a
// refusal could take longer the more of the code was right. AC8 asks that
// the code sent and the setting are each hashed with SHA-256 and the two
// digests compared by crypto.timingSafeEqual, and never with `===`. How long
// a comparison takes cannot be timed reliably in a test (the spec's test
// plan), so this holds what compares: a spy on timingSafeEqual, as AC7's
// test spies on crypto.randomBytes (adapters/device-credentials.test.ts).
//
//   - the call: timingSafeEqual is handed the SHA-256 of the code sent, as
//     the domain normalised it, and the SHA-256 of the setting, as raw
//     digests or as their hex, for the bootstrap code and for any other code;
//   - the decision: the module follows what timingSafeEqual answers. Made to
//     answer "different" for the setting itself, the join is not the first
//     admin's; made to answer "the same" for another code, it is. A `===`
//     anywhere in the decision fails one of the two.
//
// node:crypto is mocked with itself, timingSafeEqual wrapped in a spy that
// calls the real one unless a test says otherwise, so a named import and the
// default one both reach the spy. The group store is the test kit's fake.
import {
  fakeClock,
  fakeJourneyStore,
  fakeLog,
  syntheticBootstrapCode,
  syntheticDisplayName,
  syntheticInvitationCode,
  syntheticJoinKey,
} from '@trygghverdag/test-kit';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createJoinService } from './join.ts';

const timingSafeEqual = vi.hoisted(() => ({
  spy: undefined as unknown as ReturnType<typeof vi.fn>,
}));

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  const spy = vi.fn((a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView): boolean =>
    actual.timingSafeEqual(a, b),
  );
  timingSafeEqual.spy = spy;
  return { ...actual, timingSafeEqual: spy, default: { ...actual, timingSafeEqual: spy } };
});

// mockReset, not mockClear: a test's fixed answer never reaches the next
// test; the spy calls the real timingSafeEqual again.
afterEach(() => {
  timingSafeEqual.spy.mockReset();
});

/** A synthetic night, where the fake store's clock stands. */
const T = new Date('2026-10-20T21:00:00.000Z');

/** The SHA-256 of a code, as raw bytes and as the bytes of its hex: either is a digest compared. */
function digestsOf(code: string): Buffer[] {
  const raw = createHash('sha256').update(code, 'utf8').digest();
  return [raw, Buffer.from(raw.toString('hex'), 'utf8')];
}

/** The bytes a view holds, whatever kind of view it is. */
function bytesOf(view: unknown): Buffer {
  const { buffer, byteOffset, byteLength } = view as ArrayBufferView;
  return Buffer.from(buffer, byteOffset, byteLength);
}

const isDigestOf = (view: unknown, code: string): boolean =>
  digestsOf(code).some((digest) => digest.equals(bytesOf(view)));

/** Whether timingSafeEqual was ever handed the digest of `sent` and the digest of `setting`, in either order. */
function comparedDigests(sent: string, setting: string): boolean {
  return timingSafeEqual.spy.mock.calls.some(
    ([a, b]) =>
      (isDigestOf(a, sent) && isDigestOf(b, setting)) ||
      (isDigestOf(a, setting) && isDigestOf(b, sent)),
  );
}

/** A join module over an empty fake group store, with this bootstrap code. */
function joining(bootstrapCode: string) {
  const store = fakeJourneyStore({ clock: fakeClock(T) });
  const service = createJoinService({ groups: store, log: fakeLog(), bootstrapCode });
  return { store, service };
}

const joinWith = (invitationCode: string) => ({
  invitationCode,
  joinKey: syntheticJoinKey(),
  displayName: syntheticDisplayName(),
});

describe('GRP-01-AC8: the bootstrap code is compared in constant time', () => {
  test('GRP-01-AC8: the bootstrap code sent, typed in lower case and in groups, joins as the first admin, and timingSafeEqual compared the SHA-256 of the code as normalised with the SHA-256 of the setting', async () => {
    const setting = syntheticBootstrapCode();
    const { service } = joining(setting);
    const typed = `${setting.slice(0, 16).toLowerCase()}-${setting.slice(16)}`;

    const result = await service.join(joinWith(typed));

    expect(result).toMatchObject({ type: 'joined', role: 'ADMIN' });
    expect(timingSafeEqual.spy, 'timingSafeEqual was never called').toHaveBeenCalled();
    expect(comparedDigests(setting, setting)).toBe(true);
  });

  test('GRP-01-AC8: any other code is compared the same way, digest against digest, before it is tried as an invitation; it opens no group', async () => {
    const setting = syntheticBootstrapCode();
    const { store, service } = joining(setting);
    const other = syntheticInvitationCode();

    const result = await service.join(joinWith(other));

    expect(result).toEqual({ type: 'refused', reason: 'INVITATION_NOT_VALID' });
    expect(comparedDigests(other, setting)).toBe(true);
    expect(store.calls).toContain('joinWithInvitation');
    expect(store.calls).not.toContain('bootstrapGroup');
    expect(store.groups()).toEqual([]);
  });

  test('GRP-01-AC8: no comparison is of the codes themselves: everything timingSafeEqual is handed is a 32-byte digest or its 64-character hex', async () => {
    const setting = syntheticBootstrapCode();
    const { service } = joining(setting);

    await service.join(joinWith(setting));
    await service.join(joinWith(syntheticInvitationCode()));

    expect(timingSafeEqual.spy.mock.calls.length).toBeGreaterThan(0);
    for (const [a, b] of timingSafeEqual.spy.mock.calls) {
      expect([32, 64]).toContain(bytesOf(a).length);
      expect(bytesOf(b).length).toBe(bytesOf(a).length);
      expect(bytesOf(a).toString('utf8')).not.toBe(setting);
      expect(bytesOf(b).toString('utf8')).not.toBe(setting);
    }
  });

  test('GRP-01-AC8: never with ===: told by timingSafeEqual that the setting itself differs, the module does not bootstrap; it tries the code as an invitation, and no group is made', async () => {
    const setting = syntheticBootstrapCode();
    const { store, service } = joining(setting);
    timingSafeEqual.spy.mockImplementation(() => false);

    const result = await service.join(joinWith(setting));

    expect(store.calls).not.toContain('bootstrapGroup');
    expect(result).toEqual({ type: 'refused', reason: 'INVITATION_NOT_VALID' });
    expect(timingSafeEqual.spy).toHaveBeenCalled();
    expect(store.groups()).toEqual([]);
  });

  test('GRP-01-AC8: never with ===: told by timingSafeEqual that another code is the same as the setting, the module takes it as the bootstrap code', async () => {
    const setting = syntheticBootstrapCode();
    const { store, service } = joining(setting);
    timingSafeEqual.spy.mockImplementation(() => true);

    const result = await service.join(joinWith(syntheticInvitationCode()));

    expect(store.calls).toContain('bootstrapGroup');
    expect(result).toMatchObject({ type: 'joined', role: 'ADMIN' });
  });

  test('GRP-01-AC8: with no usable bootstrap code, every code is tried as an invitation, and opens no group', async () => {
    const store = fakeJourneyStore({ clock: fakeClock(T) });
    const service = createJoinService({ groups: store, log: fakeLog(), bootstrapCode: null });

    const result = await service.join(joinWith(syntheticBootstrapCode()));

    expect(result).toEqual({ type: 'refused', reason: 'INVITATION_NOT_VALID' });
    expect(store.calls).not.toContain('bootstrapGroup');
    expect(store.groups()).toEqual([]);
  });
});
