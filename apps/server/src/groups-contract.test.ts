// L2: the contract's copies of GRP-01's group rules, held to the domain's.
//
// Two things are written twice, and until this file nothing failed when one
// copy changed and the other did not (code-reviewer, PR #96):
//   - the roles: `ROLES` in packages/contracts/src/groups.ts, which the
//     join's answer and the admin's member list carry, and `ROLES` in
//     apps/server/src/domain/groups.ts, from which the database's
//     membership_role enum is made;
//   - the invitation code's shape: the contract's `INVITATION_CODE_PATTERN`,
//     which decides the fixed 400, and the domain's `normaliseInvitationCode`,
//     which decides what is a code at all.
//
// The contracts package may import neither the server nor the test kit
// (`contracts-depend-on-nothing-of-ours`, AR-07), so the pin lives in the
// server, outside domain/, where the contract, the domain and the test kit
// may all be imported.
//
// What is proven here:
//   - GRP-01-AC9: the two role lists are one list, in one order, and the
//     contract's answers take exactly those roles;
//   - GRP-01-AC2: for any string, the contract's pattern takes it exactly
//     when the domain's normaliser reads it as a code (fast-check, and named
//     cases: Crockford's O, I and L, U, the separators and their look-alikes,
//     the lengths). The one difference is the field's 100-character cap,
//     pinned exactly below.
import {
  INVITATION_CODE_PATTERN,
  ROLES as CONTRACT_ROLES,
  joinRequestSchema,
  joinResponseSchema,
  memberSchema,
} from '@trygghverdag/contracts';
import {
  fc,
  inGroupsOfFive,
  syntheticBootstrapCode,
  syntheticInvitationCode,
} from '@trygghverdag/test-kit';
import { describe, expect, test } from 'vitest';
import { ROLES as DOMAIN_ROLES, normaliseInvitationCode } from './domain/groups.ts';

/**
 * The contract's field for the code as typed: the pattern, and `.max(100)`
 * beside it. The domain's normaliser has no cap of its own.
 */
const invitationCodeField = joinRequestSchema.shape.invitationCode;

/** The field's cap, written out: a change to it fails here. */
const FIELD_MAX = 100;

/** What each side makes of a string typed as a code. */
function readings(typed: string): { pattern: boolean; field: boolean; domain: boolean } {
  return {
    pattern: INVITATION_CODE_PATTERN.test(typed),
    field: invitationCodeField.safeParse(typed).success,
    domain: normaliseInvitationCode(typed) !== null,
  };
}

describe('GRP-01-AC9: the contract’s roles are the domain’s', () => {
  test('GRP-01-AC9: the contract’s ROLES is the domain’s ROLES: the same roles, in the same order', () => {
    expect([...CONTRACT_ROLES]).toEqual([...DOMAIN_ROLES]);
  });

  test('GRP-01-AC9: the role the join’s answer and the admin’s member list carry takes the domain’s roles and nothing else', () => {
    expect(memberSchema.shape.role.options).toEqual([...DOMAIN_ROLES]);
    expect(joinResponseSchema.shape.role.options).toEqual([...DOMAIN_ROLES]);
  });
});

/** Made at run time (RG-07, synthetic test data): no credential-looking literal is written in a file. */
const STORED = syntheticInvitationCode();
const SHOWN_WITH_HYPHENS = inGroupsOfFive(STORED);
const SHOWN_WITH_SPACES = inGroupsOfFive(STORED, ' ');
const BOOTSTRAP = syntheticBootstrapCode();
/** A code of 20, then separators: 100 characters in all, and 101. */
const PADDED_TO_100 = STORED + ' '.repeat(80);
const PADDED_TO_101 = STORED + '-'.repeat(81);

describe('GRP-01-AC2: the contract’s invitation code is the domain’s', () => {
  test.each([
    ['as the store keeps it', 'taken', STORED],
    ['as the API shows it, hyphens between', 'taken', SHOWN_WITH_HYPHENS],
    ['as the API shows it, spaces between', 'taken', SHOWN_WITH_SPACES],
    ['that is the first admin’s bootstrap code, 32 hex digits', 'taken', BOOTSTRAP],
    ['in lower case', 'taken', 'abcdefghjkmnpqrstvwx'],
    ['of O and I in either case, read as 0 and 1', 'taken', 'OOOOO-ooooo-IIIII-iiiii'],
    ['of L, O and I in either case, read as 1, 0 and 1', 'taken', 'LLLLL-lllll-OIL0I-oil0i'],
    ['with separators before, after and between', 'taken', '  AbCdE-fGhJk mNpQr-StVwX  '],
    ['with runs of separators', 'taken', 'ABCDE--FGHJK  MNPQR - STVWX'],
    ['of 20 characters', 'taken', '0123456789ABCDEFGHJK'],
    ['of 32 characters', 'taken', 'ABCDEFGHJKMNPQRSTVWXYZ0123456789'],
    ['of 100 characters, separators included', 'taken', PADDED_TO_100],
    ['of nothing', 'refused', ''],
    ['of separators only', 'refused', ' - - '],
    ['of 19 characters', 'refused', 'ABCDEFGHJKMNPQRSTVW'],
    ['of 33 characters', 'refused', 'ABCDEFGHJKMNPQRSTVWXYZ0123456789A'],
    ['with a U, which Crockford leaves out', 'refused', 'ABCDEFGHJKMNPQRSTVWU'],
    ['with a lower-case u', 'refused', 'abcdefghjkmnpqrstvwu'],
    ['with tabs between the groups', 'refused', 'ABCDE\tFGHJK\tMNPQR\tSTVWX'],
    ['with underscores between the groups', 'refused', 'ABCDE_FGHJK_MNPQR_STVWX'],
    ['with full stops between the groups', 'refused', 'ABCDE.FGHJK.MNPQR.STVWX'],
    ['with en dashes between the groups', 'refused', 'ABCDE–FGHJK–MNPQR–STVWX'],
    ['with no-break spaces between', 'refused', 'ABCDE\u{a0}FGHJK\u{a0}MNPQR\u{a0}STVWX'],
    ['with a line break at the end', 'refused', 'ABCDEFGHJKMNPQRSTVWX\n'],
    ['with a dotless ı, which toUpperCase reads as I', 'refused', 'ABCDEFGHJKMNPQRSTVWı'],
    ['with a long ſ, which toUpperCase reads as S', 'refused', 'ABCDEFGHJKMNPQRSTVWſ'],
    ['with a letter outside ASCII', 'refused', 'ABCDEFGHJKMNPQRSTVWÅ'],
  ])(
    'GRP-01-AC2: a code %s is %s by the contract’s pattern, its field and the domain’s normaliser alike',
    (_what, verdict, typed) => {
      const taken = verdict === 'taken';

      expect(readings(typed)).toEqual({ pattern: taken, field: taken, domain: taken });
    },
  );

  // The one difference, and it runs one way only: the field caps what is
  // typed at 100 characters (`.max(100)`, beside the pattern), and the
  // normaliser has no cap. So a code typed with more separators than that is
  // one the domain would read, and the contract refuses it as the fixed 400
  // before the domain is asked. Nothing the contract takes is refused by the
  // domain. The spec names no cap; it is pinned as written, so a change to it,
  // either way, is seen here.
  test('GRP-01-AC2: the one difference, pinned: past 100 characters the contract’s field refuses a code the domain would read, and its pattern alone still takes it', () => {
    expect(PADDED_TO_100).toHaveLength(FIELD_MAX);
    expect(PADDED_TO_101).toHaveLength(FIELD_MAX + 1);

    expect(readings(PADDED_TO_100)).toEqual({ pattern: true, field: true, domain: true });
    expect(readings(PADDED_TO_101)).toEqual({ pattern: true, field: false, domain: true });
  });

  /** Every ASCII letter and digit, U and I, L and O among them, in both cases. */
  const LETTERS_AND_DIGITS = Array.from(
    '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  );
  /** Crockford's base32 alphabet: a code as the store keeps it. */
  const CROCKFORD = Array.from('0123456789ABCDEFGHJKMNPQRSTVWXYZ');
  /** Neither a code's character nor a separator, each one; some look like one. */
  const STRAYS = Array.from('\t\n\r_.,–\u{a0}\u{200b}ıſÅß\u{1F600}');

  const separators = (most: number) =>
    fc.array(fc.constantFrom(' ', '-'), { maxLength: most }).map((run) => run.join(''));

  /** Insert `piece` into `text` at a place `at` picks. */
  const insert = (text: string, piece: string, at: number) => {
    const place = at % (text.length + 1);
    return text.slice(0, place) + piece + text.slice(place);
  };

  /**
   * A code as a person might type one: 17 to 35 letters and digits, any case,
   * U among them, runs of separators anywhere, and now and then one stray
   * character.
   */
  const typedCode = fc
    .record({
      lead: separators(3),
      parts: fc.array(fc.tuple(fc.constantFrom(...LETTERS_AND_DIGITS), separators(3)), {
        minLength: 17,
        maxLength: 35,
      }),
      stray: fc.oneof(
        { arbitrary: fc.constant(null), weight: 3 },
        { arbitrary: fc.tuple(fc.constantFrom(...STRAYS), fc.nat()), weight: 1 },
      ),
    })
    .map(({ lead, parts, stray }) => {
      const typed = lead + parts.map(([character, run]) => character + run).join('');
      return stray === null ? typed : insert(typed, stray[0], stray[1]);
    });

  /**
   * A code of the stored shape, 20 to 32, with 50 to 100 separators put in:
   * either side of the cap. The run's length is drawn first and the run made
   * exactly that long: fast-check's default size makes an array of at most
   * 2 × its minimum + 10, so a run of up to 100 would stay at 10 or under.
   */
  const paddedCode = fc
    .record({
      code: fc
        .array(fc.constantFrom(...CROCKFORD), { minLength: 20, maxLength: 32 })
        .map((characters) => characters.join('')),
      run: fc
        .integer({ min: 50, max: 100 })
        .chain((length) =>
          fc.array(fc.constantFrom(' ', '-'), { minLength: length, maxLength: length }),
        )
        .map((run) => run.join('')),
      at: fc.nat(),
    })
    .map(({ code, run, at }) => insert(code, run, at));

  test('GRP-01-AC2: for any string, the contract’s pattern takes it exactly when the domain’s normaliser reads it as a code, and its field exactly when, besides, it is at most 100 characters (fast-check)', () => {
    const seen = { taken: 0, refused: 0, pastTheCap: 0 };

    fc.assert(
      fc.property(
        fc.oneof(typedCode, paddedCode, fc.string({ unit: 'binary', maxLength: 40 })),
        (typed) => {
          const { pattern, field, domain } = readings(typed);

          expect(pattern).toBe(domain);
          expect(field).toBe(domain && typed.length <= FIELD_MAX);

          if (field) {
            seen.taken += 1;
          } else if (domain) {
            seen.pastTheCap += 1;
          } else {
            seen.refused += 1;
          }
        },
      ),
      { numRuns: 2000 },
    );

    // Not vacuous: the strings reached every outcome, the one difference too.
    expect(seen.taken).toBeGreaterThan(0);
    expect(seen.refused).toBeGreaterThan(0);
    expect(seen.pastTheCap).toBeGreaterThan(0);
  });
});
