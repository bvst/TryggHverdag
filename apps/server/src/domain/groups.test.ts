// L2 domain: GRP-01's rules, pure, with fast-check and the fake clock.
//
// `domain/groups.ts` holds what decides who gets in and who may act as admin
// (the spec's approach item 1): the invitation code's normalisation, the
// invitation's validity and the retried join (readings 2 to 4), the seven
// days, the roles, and the admin's rules (approach items 3, 8, 9). Pure, with
// no clock of its own (AR-03): every time is handed in, here read from the
// fake clock, as the store hands in the database's now().
//
// What is proven here:
//   - GRP-01-AC2: any text either normalises to a well-formed code or is
//     refused, and the normaliser never throws (fast-check), with the
//     readings a person typing a code needs: case, spaces and hyphens, and O,
//     I and L read as 0, 1 and 1;
//   - GRP-01-AC6: valid exactly while the try is before the creation plus
//     seven days and the invitation is unused (fast-check over creation and
//     try times), so expired at seven days exactly, and a retried join only
//     with the same key, its user still a member, before then (AC5);
//   - GRP-01-AC9 (the rules): only the admin invites, lists and removes, and
//     never themself; a member who is no member is not found.
import { fakeClock, fc } from '@trygghverdag/test-kit';
import { describe, expect, test } from 'vitest';
import {
  INVITATION_VALID_FOR_MS,
  ROLES,
  decideJoin,
  decideMemberRemoval,
  mayAdminister,
  normaliseInvitationCode,
} from './groups.ts';

const SECOND = 1_000;
const DAY = 24 * 60 * 60 * SECOND;
/** Seven days (GRP-01, reading 4), written out: a wrong constant fails here as well as below. */
const SEVEN_DAYS = 7 * DAY;

/** Crockford's base32 alphabet: no I, L, O or U. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** What the normaliser hands back, and only that: upper-case Crockford characters, 20 to 32 of them. */
const WELL_FORMED = /^[0-9A-HJKMNP-TV-Z]{20,32}$/;

/** A synthetic night, from which the fake clock starts. */
const T = new Date('2026-10-20T21:00:00.000Z');

const UNUSED = null;

describe('GRP-01-AC2: the invitation code’s normaliser', () => {
  test('GRP-01-AC2: the seven days are 604 800 000 ms, in one place (reading 4)', () => {
    expect(INVITATION_VALID_FOR_MS).toBe(SEVEN_DAYS);
    expect(INVITATION_VALID_FOR_MS).toBe(604_800_000);
  });

  test('GRP-01-AC2: a code of 20 as the store keeps it is itself', () => {
    expect(normaliseInvitationCode('ABCDEFGHJKMNPQRSTVWX')).toBe('ABCDEFGHJKMNPQRSTVWX');
    expect(normaliseInvitationCode('0123456789ABCDEFGHJK')).toBe('0123456789ABCDEFGHJK');
  });

  test.each([
    ['in four groups of five, hyphens between', 'ABCDE-FGHJK-MNPQR-STVWX'],
    ['in four groups of five, spaces between', 'ABCDE FGHJK MNPQR STVWX'],
    ['in lower case', 'abcdefghjkmnpqrstvwx'],
    ['in mixed case, with spaces around', '  AbCdE-fGhJk mNpQr-StVwX  '],
    ['with several separators in a row', 'ABCDE--FGHJK  MNPQR - STVWX'],
  ])('GRP-01-AC2: the same code %s normalises to the code as stored', (_how, typed) => {
    expect(normaliseInvitationCode(typed)).toBe('ABCDEFGHJKMNPQRSTVWX');
  });

  test('GRP-01-AC2: O is read as 0, and I and L as 1, in either case, as Crockford’s base32 reads them', () => {
    expect(normaliseInvitationCode('OOOOO-ooooo-IIIII-iiiii')).toBe('00000000001111111111');
    expect(normaliseInvitationCode('LLLLL-lllll-OIL0I-oil0i')).toBe('11111111110110101101');
  });

  test('GRP-01-AC2: the first admin’s bootstrap code, 32 upper-case hex digits, is well-formed as it is, and in lower case', () => {
    const code = 'A1B2C3D4E5F60718293A4B5C6D7E8F90';

    expect(normaliseInvitationCode(code)).toBe(code);
    expect(normaliseInvitationCode(code.toLowerCase())).toBe(code);
  });

  test.each([
    ['nothing', ''],
    ['only separators', ' - - '],
    ['19 characters', 'ABCDEFGHJKMNPQRSTVW'],
    ['33 characters', 'ABCDEFGHJKMNPQRSTVWXYZ0123456789A'],
    ['a U, which Crockford’s base32 leaves out', 'ABCDEFGHJKMNPQRSTVWU'],
    ['a letter outside ASCII', 'ABCDEFGHJKMNPQRSTVWÅ'],
    ['punctuation', 'ABCDE.FGHJK.MNPQR.STVWX'],
    ['an underscore', 'ABCDE_FGHJK_MNPQR_STVWX'],
    ['a tab between the groups', 'ABCDE\tFGHJK\tMNPQR\tSTVWX'],
    ['a line break in it', 'ABCDEFGHJK\nMNPQRSTVWX'],
    ['an emoji', 'ABCDEFGHJKMNPQRSTVW\u{1F600}'],
  ])('GRP-01-AC2: %s is not a code: refused', (_what, typed) => {
    expect(normaliseInvitationCode(typed)).toBeNull();
  });

  // GRP-01, review loop 1 (test-auditor): the normaliser upper-cases what it
  // is given, and String.prototype.toUpperCase maps some letters outside
  // ASCII onto ASCII ones: dotless ı (U+0131) to I, long ſ (U+017F) to S, ß
  // to SS, the ligature ﬁ to FI. Without the ASCII filter in front, a code
  // typed with them would be read as a code nobody typed. Every such
  // character in Unicode, found by asking toUpperCase itself, is refused.
  test.each([
    ['dotless ı (U+0131), which toUpperCase() reads as I', 'ı'],
    ['long ſ (U+017F), which toUpperCase() reads as S', 'ſ'],
  ])(
    'GRP-01-AC2: a code typed with %s is refused, not normalised to the ASCII letter',
    (_what, letter) => {
      const upper = letter.toUpperCase();
      // Not vacuous: without the filter, this would be a well-formed code.
      expect(upper).toMatch(/^[A-Z]$/);
      const typed = `ABCDEFGHJKMNPQRSTVW${letter}`;
      expect(`ABCDEFGHJKMNPQRSTVW${upper}`.replace(/[IL]/g, '1')).toMatch(WELL_FORMED);

      expect(normaliseInvitationCode(typed)).toBeNull();
      expect(normaliseInvitationCode(`${letter}BCDE-FGHJK-MNPQR-STVWX`)).toBeNull();
      expect(normaliseInvitationCode(letter.repeat(20))).toBeNull();
    },
  );

  test('GRP-01-AC2: no character outside ASCII that toUpperCase() maps into A to Z is ever read as a code’s letter: every one of them in Unicode makes the code refused', () => {
    const intoAscii: string[] = [];
    for (let point = 0x80; point <= 0x10ffff; point += 1) {
      if (point >= 0xd800 && point <= 0xdfff) {
        continue;
      }
      const character = String.fromCodePoint(point);
      if (/^[A-Z]+$/.test(character.toUpperCase())) {
        intoAscii.push(character);
      }
    }

    // Not vacuous: the two the auditor named are among them.
    expect(intoAscii).toEqual(expect.arrayContaining(['ı', 'ſ']));
    for (const character of intoAscii) {
      const upper = character.toUpperCase();
      // A code that would be well-formed, 20 characters, were the character
      // read as its upper case.
      const typed = `${'ABCDEFGHJKMNPQRSTVWX'.slice(0, 20 - upper.length)}${character}`;
      expect({ character, normalised: normaliseInvitationCode(typed) }).toEqual({
        character,
        normalised: null,
      });
    }
  });

  test('GRP-01-AC2: for any string at all, the normaliser either yields a well-formed code or refuses it, never throws, and a code it yields normalises to itself', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string({ unit: 'binary', maxLength: 60 }),
          fc.string({
            unit: fc.constantFrom(...Array.from(`${ALPHABET}oilOILu -_ \t`)),
            maxLength: 40,
          }),
        ),
        (typed) => {
          // A throw here fails the property, naming the string that threw.
          const normalised = normaliseInvitationCode(typed);
          if (normalised !== null) {
            expect(normalised).toMatch(WELL_FORMED);
            expect(normaliseInvitationCode(normalised)).toBe(normalised);
          }
        },
      ),
      { numRuns: 2_000 },
    );
  });

  test('GRP-01-AC2: for any code and any way of typing it (case, spaces, hyphens, O for 0, I or L for 1), the normaliser gives back that code', () => {
    const code = fc
      .array(fc.constantFrom(...Array.from(ALPHABET)), { minLength: 20, maxLength: 20 })
      .map((characters) => characters.join(''));
    const typing = fc.array(
      fc.record({
        lower: fc.boolean(),
        lookalike: fc.boolean(),
        before: fc.constantFrom('', '', '', ' ', '-', ' - '),
      }),
      { minLength: 20, maxLength: 20 },
    );

    fc.assert(
      fc.property(code, typing, (stored, ways) => {
        const typed = Array.from(stored)
          .map((character, index) => {
            const way = ways[index] ?? { lower: false, lookalike: false, before: '' };
            let shown = character;
            if (way.lookalike && character === '0') {
              shown = 'O';
            } else if (way.lookalike && character === '1') {
              shown = index % 2 === 0 ? 'I' : 'L';
            }
            return `${way.before}${way.lower ? shown.toLowerCase() : shown}`;
          })
          .join('');

        expect(normaliseInvitationCode(typed)).toBe(stored);
      }),
      { numRuns: 1_000 },
    );
  });
});

describe('GRP-01-AC6 and AC5: an invitation’s validity, and a join retried', () => {
  test('GRP-01-AC6: made at T, by the fake clock: a join at T + 7 days − 1 ms is a join, one at T + 7 days exactly is refused, INVITATION_NOT_VALID', async () => {
    const clock = fakeClock(T);
    const invitation = { createdAt: await clock.now(), used: UNUSED };

    clock.advance(SEVEN_DAYS - 1);
    expect(decideJoin(invitation, await clock.now())).toEqual({ type: 'join' });

    clock.advance(1);
    expect(decideJoin(invitation, await clock.now())).toEqual({
      type: 'refused',
      reason: 'INVITATION_NOT_VALID',
    });

    clock.advance(1);
    expect(decideJoin(invitation, await clock.now())).toEqual({
      type: 'refused',
      reason: 'INVITATION_NOT_VALID',
    });
  });

  test('GRP-01-AC6: at the moment it was made it is valid; no invitation at all is refused', async () => {
    const clock = fakeClock(T);

    expect(decideJoin({ createdAt: T, used: UNUSED }, await clock.now())).toEqual({ type: 'join' });
    expect(decideJoin(null, await clock.now())).toEqual({
      type: 'refused',
      reason: 'INVITATION_NOT_VALID',
    });
  });

  test('GRP-01-AC6: for any creation and try times, by the fake clock, an unused invitation is a join exactly when the try is before the creation plus seven days, and a used one is never a join', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.date({
          min: new Date('2000-01-01T00:00:00.000Z'),
          max: new Date('2100-01-01T00:00:00.000Z'),
          noInvalidDate: true,
        }),
        // From the creation on: the database's clock, which made the
        // invitation, does not run backwards past it.
        fc.integer({ min: 0, max: 3 * SEVEN_DAYS }),
        fc.option(fc.record({ sameJoinKey: fc.boolean(), stillAMember: fc.boolean() }), {
          nil: null,
        }),
        async (createdAt, afterMs, used) => {
          const clock = fakeClock(createdAt);
          clock.advance(afterMs);
          const now = await clock.now();

          const decision = decideJoin({ createdAt, used }, now);

          const beforeExpiry = now.getTime() < createdAt.getTime() + SEVEN_DAYS;
          expect(decision.type === 'join').toBe(used === null && beforeExpiry);
          if (decision.type === 'refused') {
            expect(decision).toEqual({ type: 'refused', reason: 'INVITATION_NOT_VALID' });
          }
        },
      ),
      { numRuns: 1_000 },
    );
  });

  test('GRP-01-AC5: a used invitation sent again with the same join key, its user still a member, before it expires, is the same join retried', () => {
    const now = new Date(T.getTime() + DAY);

    expect(
      decideJoin({ createdAt: T, used: { sameJoinKey: true, stillAMember: true } }, now),
    ).toEqual({ type: 'retry' });
  });

  test.each([
    ['another join key', { sameJoinKey: false, stillAMember: true }, DAY],
    ['the same key, its user removed', { sameJoinKey: true, stillAMember: false }, DAY],
    ['another key, its user removed', { sameJoinKey: false, stillAMember: false }, DAY],
    ['the same key, once expired', { sameJoinKey: true, stillAMember: true }, SEVEN_DAYS],
  ])(
    'GRP-01-AC5: a used invitation with %s is refused, INVITATION_NOT_VALID',
    (_what, used, afterMs) => {
      expect(decideJoin({ createdAt: T, used }, new Date(T.getTime() + afterMs))).toEqual({
        type: 'refused',
        reason: 'INVITATION_NOT_VALID',
      });
    },
  );

  test('GRP-01-AC5: for any times, a retry is answered exactly when the invitation is used with the same key, its user still a member, and the try is before the seven days end', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 * SEVEN_DAYS }),
        fc.boolean(),
        fc.boolean(),
        (afterMs, sameJoinKey, stillAMember) => {
          const decision = decideJoin(
            { createdAt: T, used: { sameJoinKey, stillAMember } },
            new Date(T.getTime() + afterMs),
          );

          expect(decision.type === 'retry').toBe(
            sameJoinKey && stillAMember && afterMs < SEVEN_DAYS,
          );
          expect(decision.type).not.toBe('join');
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe('GRP-01-AC9: who may act as the admin, and on whom', () => {
  test('GRP-01-AC9: there are two roles, ADMIN and MEMBER', () => {
    expect([...ROLES].sort()).toEqual(['ADMIN', 'MEMBER']);
  });

  test('GRP-01-AC9: only the admin may invite and list the members: not a member, and not someone who is no member', () => {
    expect(mayAdminister({ role: 'ADMIN' })).toBe(true);
    expect(mayAdminister({ role: 'MEMBER' })).toBe(false);
    expect(mayAdminister(null)).toBe(false);
  });

  const ADMIN = { userId: 'a9e0b1c2-0000-4000-8000-00000000000a', role: 'ADMIN' } as const;
  const MEMBER = { userId: 'b9e0b1c2-0000-4000-8000-00000000000b', role: 'MEMBER' } as const;
  const OTHER = { userId: 'c9e0b1c2-0000-4000-8000-00000000000c', role: 'MEMBER' } as const;

  test.each([
    ['the admin removing a member', ADMIN, MEMBER, { type: 'remove' }],
    [
      'the admin removing themself',
      ADMIN,
      ADMIN,
      { type: 'refused', reason: 'CANNOT_REMOVE_ADMIN' },
    ],
    [
      'the admin removing someone who is no member',
      ADMIN,
      null,
      { type: 'refused', reason: 'MEMBER_NOT_FOUND' },
    ],
    ['a member removing another', MEMBER, OTHER, { type: 'refused', reason: 'NOT_THE_ADMIN' }],
    ['a member removing the admin', MEMBER, ADMIN, { type: 'refused', reason: 'NOT_THE_ADMIN' }],
    ['a member removing themself', MEMBER, MEMBER, { type: 'refused', reason: 'NOT_THE_ADMIN' }],
    [
      'a member removing someone who is no member',
      MEMBER,
      null,
      { type: 'refused', reason: 'NOT_THE_ADMIN' },
    ],
    [
      'someone who is no member removing a member',
      null,
      MEMBER,
      { type: 'refused', reason: 'NOT_THE_ADMIN' },
    ],
  ] as const)('GRP-01-AC9 and AC16: %s', (_what, caller, member, decision) => {
    expect(decideMemberRemoval(caller, member)).toEqual(decision);
  });

  test('GRP-01-AC16: for any caller and member, a removal is decided only for the admin removing a member who is not the admin; a caller who is not the admin learns nothing else, whoever they name', () => {
    const someone = fc.option(
      fc.record({
        userId: fc.constantFrom(ADMIN.userId, MEMBER.userId, OTHER.userId),
        role: fc.constantFrom('ADMIN' as const, 'MEMBER' as const),
      }),
      { nil: null },
    );

    fc.assert(
      fc.property(someone, someone, (caller, member) => {
        const decision = decideMemberRemoval(caller, member);

        const removes =
          caller?.role === 'ADMIN' &&
          member !== null &&
          member.role !== 'ADMIN' &&
          member.userId !== caller.userId;
        expect(decision.type === 'remove').toBe(removes);
        if (caller?.role !== 'ADMIN') {
          expect(decision).toEqual({ type: 'refused', reason: 'NOT_THE_ADMIN' });
        }
      }),
      { numRuns: 500 },
    );
  });
});
