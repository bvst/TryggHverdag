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
//
// Review loop 2 (test-auditor S2): this file is also where the groups
// module's other L2 test lives, the invitation the store cannot create
// (AC24), at the end. It pins invitation_failed's stage at L2. The membership
// mutation group runs groups.system.test.ts alone (AC32; running this file in
// it was tried and withdrawn, the spec's Mutation section), so no mutation
// run has this test yet.
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
import { createInvitationService } from './invitations.ts';
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

// A code the domain's normaliser refuses (GRP-01-AC2). The contract lets only
// codes through, so no request at L6 reaches this: the module is called here
// directly, as a caller the contract did not guard would call it. Every shape
// is built from a synthetic code a character away from a real one, the
// bootstrap code among them, so a refusal that keyed on anything but the
// normaliser's answer would show. None may reach the store, make a group, or
// write a line: a refusal is the caller's answer (approach item 13).
describe('GRP-01-AC2: a code that is not a code lets nobody in, and asks the store nothing', () => {
  test.each([
    {
      shape: 'empty',
      typed: (): string => '',
    },
    {
      shape: 'one character short of an invitation code',
      typed: (): string => syntheticInvitationCode().slice(0, 19),
    },
    {
      shape: 'the bootstrap code with one character more',
      typed: (setting: string): string => `${setting}0`,
    },
    {
      shape: 'a U, which is no character of the alphabet even once normalised',
      typed: (): string => `${syntheticInvitationCode().slice(0, 19)}U`,
    },
    {
      shape: 'a character that is not a code’s at all',
      typed: (): string => `${syntheticInvitationCode().slice(0, 19)}!`,
    },
    {
      shape: 'a tab between its groups',
      typed: (): string => {
        const code = syntheticInvitationCode();
        return `${code.slice(0, 10)}\t${code.slice(10)}`;
      },
    },
    {
      shape:
        'the bootstrap code with a letter outside ASCII that upper-cases to one of the alphabet’s',
      typed: (setting: string): string => `${setting.slice(0, 31)}ſ`,
    },
  ])(
    'GRP-01-AC2: a code the normaliser refuses ($shape) is the one refusal, INVITATION_NOT_VALID; the store is never asked, no group is made, and no line is written',
    async ({ typed }) => {
      const setting = syntheticBootstrapCode();
      const store = fakeJourneyStore({ clock: fakeClock(T) });
      const log = fakeLog();
      const service = createJoinService({ groups: store, log, bootstrapCode: setting });

      const result = await service.join(joinWith(typed(setting)));

      expect(result).toEqual({ type: 'refused', reason: 'INVITATION_NOT_VALID' });
      expect(store.calls).toEqual([]);
      expect(store.groups()).toEqual([]);
      expect(log.events).toEqual([]);
    },
  );
});

/**
 * A store failure as Drizzle throws one: its message names the query's
 * parameters, here the code, the join key and the display name the join sent,
 * and PostgreSQL's SQLSTATE sits on its cause, not on the error itself.
 */
function storeFailure(sqlstate: string, parameters: readonly string[]): Error {
  return new Error(`Failed query: params: ${parameters.join(',')}`, {
    cause: Object.assign(new Error('the database could not answer'), { code: sqlstate }),
  });
}

// The store failing the join (GRP-01-AC24, PRIV-07). The module writes one
// closed line, the stage and the SQLSTATE, and rethrows the store's own
// error: a failure is never swallowed, and never turned into the refusal a
// person would read as "the code is wrong". The line holds nothing the join
// sent, though the error's message does. The bootstrap path and the
// invitation path each reach the store by its own call, so each is failed.
describe('GRP-01-AC24: a join the store fails is one closed log line, and the store’s error, never a refusal', () => {
  test.each([
    {
      path: 'bootstrapGroup' as const,
      sqlstate: '40001',
      sent: (setting: string): string => setting,
    },
    {
      path: 'joinWithInvitation' as const,
      sqlstate: '23505',
      sent: (): string => syntheticInvitationCode(),
    },
  ])(
    'GRP-01-AC24: when $path rejects with SQLSTATE $sqlstate, the join rejects with that same error, and exactly one join_failed line is written, at the store stage with the SQLSTATE, holding no code, join key or display name',
    async ({ path, sqlstate, sent }) => {
      const setting = syntheticBootstrapCode();
      const store = fakeJourneyStore({ clock: fakeClock(T) });
      const log = fakeLog();
      const service = createJoinService({ groups: store, log, bootstrapCode: setting });
      const call = joinWith(sent(setting));
      const error = storeFailure(sqlstate, [call.invitationCode, call.joinKey, call.displayName]);
      store.failWith(error, path);

      await expect(service.join(call)).rejects.toBe(error);

      expect(store.calls).toEqual([path]);
      expect(log.events).toEqual([{ event: 'join_failed', stage: 'store', code: sqlstate }]);
      const written = JSON.stringify(log.events);
      for (const secret of [call.invitationCode, call.joinKey, call.displayName]) {
        expect(written).not.toContain(secret);
      }
    },
  );
});

// The store failing an invitation's creation (GRP-01-AC24, review loop 2,
// test-auditor S2, PRIV-07), written as the join's are above. The admin's call
// is otherwise valid: the failure is the store's alone. The module writes one
// closed line, the stage and the SQLSTATE, and rethrows the store's own error,
// never turning it into a refusal. The error's message names the admin's ID,
// as Drizzle's names a query's parameters; the line holds no ID and no code.
// Two SQLSTATEs, so the line's code is the store's, not a constant.
describe('GRP-01-AC24: an invitation the store fails is one closed log line, and the store’s error, never a refusal', () => {
  test.each([{ sqlstate: '40001' }, { sqlstate: '57P01' }])(
    'GRP-01-AC24: when createInvitation rejects with SQLSTATE $sqlstate, the invitation rejects with that same error, and exactly one invitation_failed line is written, at the store stage with the SQLSTATE, holding no code and no ID',
    async ({ sqlstate }) => {
      const store = fakeJourneyStore({ clock: fakeClock(T) });
      const log = fakeLog();
      const adminId = store.addMember(undefined, { role: 'ADMIN' });
      const service = createInvitationService({ groups: store, log });
      const error = storeFailure(sqlstate, [adminId]);
      store.failWith(error, 'createInvitation');

      await expect(service.create({ adminId })).rejects.toBe(error);

      expect(store.calls).toEqual(['createInvitation']);
      expect(log.events).toEqual([{ event: 'invitation_failed', stage: 'store', code: sqlstate }]);
      const written = JSON.stringify(log.events);
      expect(written).not.toContain(adminId);
      expect(written).not.toMatch(/[0-9A-HJKMNP-TV-Z]{5}-?[0-9A-HJKMNP-TV-Z]{5}/);
      expect(store.invitations()).toEqual([]);
    },
  );
});
