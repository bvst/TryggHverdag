// L2 domain: the watchdog's timing, and the budget it must fit (LOST-02).
//
// The reliability target (03-safety-reliability-security.md, binding under
// D-022) gives responders 60 seconds past the five-minute threshold
// (ALERT_TIME_SLACK_MS). Everything the watchdog does in time has to fit
// inside that, and the numbers that decide it live in one pure module,
// domain/watchdog.ts, so they are pinned and checked against each other here:
//   - the sweep runs every WATCHDOG_INTERVAL_MS: 10 s, the owner's choice
//     within AR-06's 10–15 s (D-107);
//   - a session idle in a transaction is ended after
//     IDLE_IN_TRANSACTION_LIMIT_MS (10 s), and the API waits at most
//     LOCK_WAIT_LIMIT_MS (5 s) for a row (approach item 7);
//   - a journey still overdue STUCK_AFTER_MS (30 s) past the threshold is
//     reported, and stops the beat (approach item 6);
//   - the minute check-in follows a beat at most BEAT_FRESH_MS (30 s) old;
//   - a claim leases its messages for CLAIM_LEASE_MS (30 s), at most
//     CLAIM_BATCH (50) at a time, and a failed message waits
//     retryDelayMs(attempts): 10 s, doubling, capped at 60 s (approach item 5).
//
// Why each budget line holds: a stall the idle limit already ends (one
// interval plus the limit) is never reported as stuck, and a stuck journey is
// reported, and then swept, inside the 60 s.
import { fc } from '@trygghverdag/test-kit';
import { describe, expect, test } from 'vitest';
import { LOST_CONTACT_AFTER_MS } from './journey.ts';
import {
  ALERT_TIME_SLACK_MS,
  BEAT_FRESH_MS,
  CLAIM_BATCH,
  CLAIM_LEASE_MS,
  IDLE_IN_TRANSACTION_LIMIT_MS,
  LOCK_WAIT_LIMIT_MS,
  SMS_UNSENT_LIMIT_MS,
  STUCK_AFTER_MS,
  WATCHDOG_INTERVAL_MS,
  isStuck,
  retryDelayMs,
} from './watchdog.ts';

const SECOND = 1_000;
const SILENT_SINCE = new Date('2026-10-01T21:30:00.000Z');

/** The moment `ms` after the silence began. */
const after = (ms: number) => new Date(SILENT_SINCE.getTime() + ms);

describe('LOST-02: the watchdog’s timing, pinned', () => {
  test('LOST-02-AC17: the values are the spec’s: a 10 s interval (D-107), a 10 s idle limit, a 5 s lock wait, 30 s to stuck, 30 s for a fresh beat, a 30 s lease, 50 a claim, and 60 s of slack', () => {
    expect({
      WATCHDOG_INTERVAL_MS,
      IDLE_IN_TRANSACTION_LIMIT_MS,
      LOCK_WAIT_LIMIT_MS,
      STUCK_AFTER_MS,
      BEAT_FRESH_MS,
      CLAIM_LEASE_MS,
      CLAIM_BATCH,
      ALERT_TIME_SLACK_MS,
    }).toEqual({
      WATCHDOG_INTERVAL_MS: 10 * SECOND,
      IDLE_IN_TRANSACTION_LIMIT_MS: 10 * SECOND,
      LOCK_WAIT_LIMIT_MS: 5 * SECOND,
      STUCK_AFTER_MS: 30 * SECOND,
      BEAT_FRESH_MS: 30 * SECOND,
      CLAIM_LEASE_MS: 30 * SECOND,
      CLAIM_BATCH: 50,
      ALERT_TIME_SLACK_MS: 60 * SECOND,
    });
  });

  test('LOST-02-AC17: the interval is within AR-06’s 10 to 15 seconds', () => {
    expect(WATCHDOG_INTERVAL_MS).toBeGreaterThanOrEqual(10 * SECOND);
    expect(WATCHDOG_INTERVAL_MS).toBeLessThanOrEqual(15 * SECOND);
  });

  test('LOST-02-AC17: the budget holds: a stall the idle limit ends, one interval plus the limit, is never reported as stuck', () => {
    expect(WATCHDOG_INTERVAL_MS + IDLE_IN_TRANSACTION_LIMIT_MS).toBeLessThan(STUCK_AFTER_MS);
  });

  test('LOST-02-AC17: the budget holds: a stuck journey, and the sweep after it, fit inside the 60 s the reliability target allows', () => {
    expect(STUCK_AFTER_MS + WATCHDOG_INTERVAL_MS).toBeLessThanOrEqual(ALERT_TIME_SLACK_MS);
  });

  test('LOST-02-AC17: a frozen holder costs an alert at most one limit plus one interval, inside the slack (D-107: 20 s, leaving 40 s for the push)', () => {
    expect(IDLE_IN_TRANSACTION_LIMIT_MS + WATCHDOG_INTERVAL_MS).toBeLessThanOrEqual(
      ALERT_TIME_SLACK_MS - 40 * SECOND,
    );
  });

  test('LOST-02-AC19: a fresh beat is three sweeps: the minute check-in tolerates two missed sweeps, and not a third', () => {
    expect(BEAT_FRESH_MS).toBe(3 * WATCHDOG_INTERVAL_MS);
  });
});

describe('LOST-02: a journey the watchdog cannot move', () => {
  test('LOST-02-AC20: stuck from 5 min 30 s of silence, not at 5 min 29.999 s', () => {
    expect(isStuck({ silentSince: SILENT_SINCE, now: after(5 * 60 * SECOND + 29_999) })).toBe(
      false,
    );
    expect(isStuck({ silentSince: SILENT_SINCE, now: after(5 * 60 * SECOND + 30 * SECOND) })).toBe(
      true,
    );
  });

  test('LOST-02-AC20: for any silence, stuck exactly when it has lasted the threshold plus STUCK_AFTER_MS or more, a clock that ran backwards included', () => {
    fc.assert(
      fc.property(fc.integer({ min: -3_600_000, max: 7_200_000 }), (silentForMs) => {
        expect(isStuck({ silentSince: SILENT_SINCE, now: after(silentForMs) })).toBe(
          silentForMs >= LOST_CONTACT_AFTER_MS + STUCK_AFTER_MS,
        );
      }),
    );
  });
});

describe('LOST-02: a message the port did not accept is tried again, later and later', () => {
  test('LOST-02-AC15: after the 1st to 5th failed attempts the message is due again after 10, 20, 40, 60 and 60 s', () => {
    expect([1, 2, 3, 4, 5].map((attempts) => retryDelayMs(attempts))).toEqual([
      10 * SECOND,
      20 * SECOND,
      40 * SECOND,
      60 * SECOND,
      60 * SECOND,
    ]);
  });

  test('LOST-02-AC15: for any number of attempts, the delay is never under 10 s nor over 60 s, never shrinks as attempts grow, and is a whole number of milliseconds', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (attempts) => {
        const delay = retryDelayMs(attempts);
        expect(Number.isInteger(delay)).toBe(true);
        expect(delay).toBeGreaterThanOrEqual(10 * SECOND);
        expect(delay).toBeLessThanOrEqual(60 * SECOND);
        expect(retryDelayMs(attempts + 1)).toBeGreaterThanOrEqual(delay);
      }),
    );
  });

  test('LOST-02-AC15: from the 4th attempt on, every delay is the 60 s cap, however many attempts', () => {
    fc.assert(
      fc.property(fc.integer({ min: 4, max: Number.MAX_SAFE_INTEGER }), (attempts) => {
        expect(retryDelayMs(attempts)).toBe(60 * SECOND);
      }),
    );
  });
});

describe('LOST-03: a stand-down never overtakes the lost-contact push it stands down', () => {
  // The hold (LOST-03, approach item 4, step 4): a responder's stand-down is
  // due no earlier than the next_attempt_at of their withdrawn lost-contact
  // message, when that message was handed over and is not due yet. That
  // time is the end of a claim's lease, or a retry's due time, so the
  // longest a stand-down waits is the larger of CLAIM_LEASE_MS and the
  // longest retry delay. Pinned here so a change to either shows.
  test('LOST-03-AC8: the longest a stand-down is held, the larger of CLAIM_LEASE_MS and the longest retry delay, is 60 s', () => {
    expect(Math.max(CLAIM_LEASE_MS, retryDelayMs(Number.MAX_SAFE_INTEGER))).toBe(60 * SECOND);
  });

  test('LOST-03-AC8: for any number of attempts a withdrawn message had, the hold it can cause, its lease or its retry, is never over 60 s', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (attempts) => {
        expect(Math.max(CLAIM_LEASE_MS, retryDelayMs(attempts))).toBeLessThanOrEqual(60 * SECOND);
      }),
    );
  });
});

// LOST-07 (its spec's approach item 8): an escalation SMS still unsent and
// not withdrawn this long after it was written counts as failing, whatever
// the cause, and the minute check pages the owner. A monitoring threshold,
// kept here beside the budget it belongs to.
describe('LOST-07: the SMS check’s threshold, pinned beside the budget it belongs to', () => {
  test('LOST-07-AC10: SMS_UNSENT_LIMIT_MS is exactly 60 s', () => {
    expect(SMS_UNSENT_LIMIT_MS).toBe(60 * SECOND);
  });

  test('LOST-07-AC10: a failure a retry fixes is no page: one run of the SMS loop, then a first and a second retry, all come within the limit', () => {
    expect(WATCHDOG_INTERVAL_MS + retryDelayMs(1) + retryDelayMs(2)).toBeLessThan(
      SMS_UNSENT_LIMIT_MS,
    );
  });
});
