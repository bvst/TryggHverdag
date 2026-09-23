import { describe, expect, test } from 'vitest';
import { databaseTime } from './database-time.ts';

const MOMENT = '2026-09-23T05:18:34.386Z';

describe('databaseTime', () => {
  test('REL-01: reads the text PostgreSQL actually sends for a timestamptz', () => {
    // This exact string is what CI's integration run produced, and what the
    // first version of databaseClock handed on as if it were a Date.
    expect(databaseTime('2026-09-23 05:18:34.38631+00').toISOString()).toBe(MOMENT);
  });

  test('REL-01: a non-zero offset is respected, not dropped', () => {
    // Norway in summer is +02. Treating this as UTC would put every "has it
    // been more than N minutes" decision out by two hours.
    expect(databaseTime('2026-09-23 07:18:34.386+02').toISOString()).toBe(MOMENT);
  });

  test('REL-01: an offset with minutes is read as written', () => {
    expect(databaseTime('2026-09-23 05:48:34.386+00:30').toISOString()).toBe(MOMENT);
  });

  test('REL-01: ISO form passes through unchanged', () => {
    expect(databaseTime(MOMENT).toISOString()).toBe(MOMENT);
  });

  test('REL-01: a Date is returned as it is, for the driver that does parse', () => {
    const already = new Date(MOMENT);

    expect(databaseTime(already)).toBe(already);
  });

  test('REL-01: a timestamp with no time zone is refused rather than guessed', () => {
    // The dangerous one. Reading this as UTC or as local time is a guess, and
    // it would be wrong silently — no error, just decisions out by hours.
    expect(() => databaseTime('2026-09-23 05:18:34.38631')).toThrow(/no time zone/);
  });

  test('REL-01: a string that is not a time is refused', () => {
    expect(() => databaseTime('not a time+00')).toThrow(/is not a time/);
  });

  test('REL-01: an invalid Date is refused rather than passed on', () => {
    expect(() => databaseTime(new Date('nonsense'))).toThrow(/invalid Date/);
  });

  test('REL-01: null is refused, and says so', () => {
    expect(() => databaseTime(null)).toThrow(/returned null where a time was expected/);
  });

  test('REL-01: a number is refused — epoch seconds and milliseconds look alike', () => {
    expect(() => databaseTime(1_790_000_000)).toThrow(/returned number where a time was expected/);
  });

  test('REL-01: undefined is refused', () => {
    expect(() => databaseTime(undefined)).toThrow(/returned undefined where a time was expected/);
  });

  test('REL-01: an offset written without its colon is read the same way', () => {
    expect(databaseTime('2026-09-23 07:18:34.386+0200').toISOString()).toBe(MOMENT);
  });

  test('REL-01: surrounding whitespace does not make a time unreadable', () => {
    // A driver or a proxy that pads the value must not turn into a refusal to
    // say what time it is — that would take the health endpoint down over a space.
    expect(databaseTime('  2026-09-23 05:18:34.386+00\n').toISOString()).toBe(MOMENT);
  });

  test('the refusal names the value and says what to do about it', () => {
    // These messages are the entire value of failing loudly, so they are held
    // to their wording rather than to a fragment of it: whoever reads this at
    // three in the morning needs the value and the cause in one line.
    expect(() => databaseTime('2026-09-23 05:18:34.38631')).toThrow(
      'The database returned "2026-09-23 05:18:34.38631", which carries no time zone. ' +
        'Reading it as UTC or as local time would be a guess, and a safety decision made ' +
        'on a guessed clock is worse than no answer. The column should be timestamptz.',
    );
  });

  test('the refusal for a missing value names the default source', () => {
    expect(() => databaseTime(null)).toThrow(
      'The database returned null where a time was expected, so nothing can be timed against it.',
    );
  });

  test('the refusal for an invalid Date names the default source', () => {
    expect(() => databaseTime(new Date('nonsense'))).toThrow(
      'The database returned an invalid Date, so nothing can be timed against it.',
    );
  });

  test('names what asked, so the error says which read failed', () => {
    expect(() => databaseTime(null, 'The heartbeat row')).toThrow(/^The heartbeat row returned/);
  });
});
