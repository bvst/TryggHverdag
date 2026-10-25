/**
 * The walker's #1 contact (GRP-02, approach items 1 to 3 and 7): a name and a
 * phone number, both typed, and nothing else (Q2, D-141).
 *
 *   - The name follows the contract's display-name rule, the one rule for
 *     every name the app shows, so #1's name cannot read as someone else's
 *     (GRP-01-AC31's reasoning). It is kept trimmed.
 *   - The number is any phone number (D-013; reading 1): whitespace, hyphens,
 *     full stops and parentheses are dropped and nothing else is changed, no
 *     country code added, removed or rewritten; what is left must be an
 *     optional first `+` and then 3 to 15 ASCII digits (15 is E.164's
 *     longest; 3 lets a short service number through). An emergency number is
 *     not refused: the walker chooses whom they call first, and the call
 *     button's own module, features/call/phone.ts, keeps it, or anything
 *     Android would read as one, away from ACTION_CALL (CALL-01, approach 2).
 *     This rule is not what guards that.
 *
 * Pure: no storage, no clock, no log.
 */
import { isUsableDisplayName } from '@trygghverdag/contracts/display-name';

/** #1, as kept and shown: the trimmed name and the number in its normalised form. */
export interface FirstContact {
  name: string;
  number: string;
}

/** What the phone holds of #1: one, none, or a value it cannot read (GRP-02-AC8). */
export type FirstContactState =
  { kind: 'set'; contact: FirstContact } | { kind: 'none' } | { kind: 'unreadable' };

/** What the number rule drops from a number as typed. */
const SEPARATORS = /[\s\-.()]/g;

/** What is left must be this: an optional first +, then 3 to 15 ASCII digits. */
const NORMALISED = /^\+?[0-9]{3,15}$/;

/** The number in its normalised form, exactly what is shown and dialled, or null when the rule refuses it. */
export function normaliseNumber(typed: string): string | null {
  const number = typed.replace(SEPARATORS, '');
  return NORMALISED.test(number) ? number : null;
}

/** #1 as typed on the setup screen, if the rules take both: the name trimmed, the number normalised. */
export function firstContactOf(
  typed: FirstContact,
): FirstContact | 'nameNotUsable' | 'numberNotUsable' {
  if (!isUsableDisplayName(typed.name)) {
    return 'nameNotUsable';
  }
  const number = normaliseNumber(typed.number);
  return number === null ? 'numberNotUsable' : { name: typed.name.trim(), number };
}

/**
 * #1 as secure storage holds it: nothing, one JSON value `{ name, number }`,
 * or something the app cannot read as a #1 (not JSON, not an object, or a name
 * or a number the rules refuse), which is said, never shown as a stale name.
 */
export function storedFirstContact(stored: string | null): FirstContactState {
  if (stored === null) {
    return { kind: 'none' };
  }
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    return { kind: 'unreadable' };
  }
  const { name, number } = (typeof value === 'object' && value !== null ? value : {}) as {
    name?: unknown;
    number?: unknown;
  };
  if (typeof name !== 'string' || typeof number !== 'string') {
    return { kind: 'unreadable' };
  }
  const contact = firstContactOf({ name, number });
  return typeof contact === 'string' ? { kind: 'unreadable' } : { kind: 'set', contact };
}
