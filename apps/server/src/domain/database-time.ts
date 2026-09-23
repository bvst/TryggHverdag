/**
 * Turning what the database said into a moment (REL-01, AR-03).
 *
 * This exists because of a bug the integration tests caught and nothing else
 * could have. `databaseClock` asked for `select now()` and told TypeScript the
 * answer was a `Date`. It was not: drizzle-orm's node-postgres driver installs
 * its own type parsers so that it can map columns itself, so a query written
 * through the schema comes back as a `Date` while a raw `sql` query comes back
 * as PostgreSQL's own text — `2026-09-23 05:18:34.38631+00`. The type argument
 * silenced the compiler; production would have thrown `getTime is not a
 * function` on every call to `/v1/health`, and every later safety decision that
 * asks what time it is.
 *
 * So the conversion is done here, once, explicitly, and it is pure — which
 * means it is tested at L2 on every machine rather than only where Docker runs.
 *
 * It refuses rather than guesses. A timestamp with no time zone is the one that
 * matters: PostgreSQL renders `timestamptz` with an offset always, so a value
 * without one means the column or the session is not what this code thinks it
 * is. Reading it as UTC, or as local time, would put every "has it been more
 * than N minutes" decision out by hours without anything going red.
 */

/**
 * PostgreSQL writes a `timestamptz` as `2026-09-23 05:18:34.38631+00`: a space
 * where ISO 8601 wants a T, and an offset given as bare hours. Both are
 * normalised here so that the check below has exactly one shape to look for —
 * an offset that is either `Z` or `+HH:MM`, and nothing optional about it.
 *
 * The optionality is worth removing rather than tolerating. A pattern that also
 * accepts spellings nothing can produce has branches no test can reach, and an
 * unreachable branch in the code that decides what time it is is somewhere a
 * mistake can live without ever going red.
 */
function toIsoForm(text: string): string {
  // One anchored pattern, not two. Two sequential replaces meant two `$`
  // anchors, and each could be removed without any realistic timestamp
  // noticing — two mutants that survived for want of an input rather than for
  // want of a test. Saying it once leaves one anchor and one thing to get right.
  return text
    .trim()
    .replace(' ', 'T')
    .replace(/([+-]\d\d):?(\d\d)?$/, (_match, hours: string, minutes?: string) => {
      return `${hours}:${minutes ?? '00'}`;
    });
}

const HAS_ZONE = /(?:Z|[+-]\d\d:\d\d)$/;

export function databaseTime(value: unknown, what = 'The database'): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error(`${what} returned an invalid Date, so nothing can be timed against it.`);
    }
    return value;
  }

  if (typeof value !== 'string') {
    throw new Error(
      `${what} returned ${value === null ? 'null' : typeof value} where a time was expected, ` +
        'so nothing can be timed against it.',
    );
  }

  const iso = toIsoForm(value);
  if (!HAS_ZONE.test(iso)) {
    throw new Error(
      `${what} returned "${value}", which carries no time zone. Reading it as UTC or as local ` +
        'time would be a guess, and a safety decision made on a guessed clock is worse than no ' +
        'answer. The column should be timestamptz.',
    );
  }

  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${what} returned "${value}", which is not a time.`);
  }
  return parsed;
}
