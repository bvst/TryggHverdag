// L2 domain: the staging canary's verdict, its timings and its identities
// (REL-10; D-127, D-128).
//
// The canary decides whether the alert reached the push port in time on the
// database's times alone: last contact, the alert's opening, and the now() of
// the first read that saw the port's answer (the spec's approach item 6). That
// rule is pure, so it is held here for any times (fast-check), and at its two
// edges to the millisecond: an alert that opens before the five minutes is a
// false alarm of its own (OPENED_EARLY); one whose answer comes after five
// minutes plus 60 s is a missed alert (NOT_HANDED_OVER).
//
// The timings are checked against each other, not only pinned: the first look
// comes before an alert could open, the deadline is the reliability target's
// number, a run fits inside its limit and its limit inside the 15 minutes
// between runs, and the canary always ends its journey before its alert could
// escalate to SMS (AC7). Times are written out here (five minutes, 60 s, two
// minutes, 10 s a request), not only read from the domain's constants, so a
// wrong constant fails here as well as in the module that uses it.
//
// And the canary's three fixed IDs, which tell its rows apart from every
// other, are pinned to the values the test kit's fake registers (D-128, AC14).
import {
  CANARY_IDS,
  FAKE_CANARY_OUTCOMES,
  SYNTHETIC_CHECK_UUID,
  fc,
  syntheticUuid,
} from '@trygghverdag/test-kit';
import { describe, expect, test } from 'vitest';
import {
  CANARY_DEADLINE_MS,
  CANARY_DEVICE_ID,
  CANARY_FIRST_LOOK_MS,
  CANARY_LEFTOVER_AFTER_MS,
  CANARY_OUTCOMES,
  CANARY_POLL_MS,
  CANARY_RESPONDER_ID,
  CANARY_RUN_LIMIT_MS,
  CANARY_STAND_DOWN_LIMIT_MS,
  CANARY_STOP_LIMIT_MS,
  CANARY_WALKER_ID,
  MISSED_ALERT_OUTCOMES,
  alertVerdict,
  isLeftover,
  reportFor,
  type CanaryOutcome,
} from './canary.ts';
import { ESCALATE_AFTER_MS, LOST_CONTACT_AFTER_MS } from './journey.ts';
import { ALERT_TIME_SLACK_MS } from './watchdog.ts';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
/** D-021: the lost-contact threshold. */
const FIVE_MINUTES = 5 * MINUTE;
/** The reliability target's slack past the threshold (03-safety-reliability-security.md). */
const SLACK = 60 * SECOND;
/** D-019: the escalation to SMS. */
const TWO_MINUTES = 2 * MINUTE;
/** The canary client's own timeout for each request (the interfaces' CANARY_REQUEST_TIMEOUT_MS). */
const REQUEST_TIMEOUT = 10 * SECOND;
/** How often the canary runs: its cron line, every 15 minutes. */
const FIFTEEN_MINUTES = 15 * MINUTE;

/** A synthetic night: last contact at 21:00 UTC on 1 October 2026. */
const LAST_CONTACT = new Date('2026-10-01T21:00:00.000Z');

/** The moment `ms` after last contact. */
const after = (ms: number) => new Date(LAST_CONTACT.getTime() + ms);

const LOWER_V4_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('REL-10: the canary’s identities', () => {
  test('REL-10-AC14: the walker, the responder and the device are three different lower-case v4 UUIDs, pinned: the values the test kit’s fake registers', () => {
    const ids = [CANARY_WALKER_ID, CANARY_RESPONDER_ID, CANARY_DEVICE_ID];

    for (const id of ids) {
      expect(id).toMatch(LOWER_V4_UUID);
    }
    expect(new Set(ids).size).toBe(3);
    expect({
      walkerId: CANARY_WALKER_ID,
      responderId: CANARY_RESPONDER_ID,
      deviceId: CANARY_DEVICE_ID,
    }).toEqual({
      walkerId: '6567904a-e65e-4f15-961f-bea85e86fb34',
      responderId: 'c7c43147-c1af-49e2-afe2-3a7aeb06717a',
      deviceId: 'f0920eb9-85b7-4e5b-8e6a-eeeb3d6f8342',
    });
    expect({
      walkerId: CANARY_WALKER_ID,
      responderId: CANARY_RESPONDER_ID,
      deviceId: CANARY_DEVICE_ID,
    }).toEqual(CANARY_IDS);
  });

  test('REL-10-AC14: none of them equals an ID the test kit’s builders make: its all-zero check UUID, or any of 10 000 synthetic UUIDs', () => {
    const ids = new Set([CANARY_WALKER_ID, CANARY_RESPONDER_ID, CANARY_DEVICE_ID]);
    const made = [SYNTHETIC_CHECK_UUID, ...Array.from({ length: 10_000 }, () => syntheticUuid())];

    expect(made.filter((id) => ids.has(id))).toEqual([]);
  });
});

describe('REL-10: the canary’s timings, pinned and checked against each other', () => {
  test('REL-10-AC5: the deadline is the reliability target’s: LOST_CONTACT_AFTER_MS plus ALERT_TIME_SLACK_MS, 360 000 ms', () => {
    expect(CANARY_DEADLINE_MS).toBe(LOST_CONTACT_AFTER_MS + ALERT_TIME_SLACK_MS);
    expect(CANARY_DEADLINE_MS).toBe(FIVE_MINUTES + SLACK);
    expect(CANARY_DEADLINE_MS).toBe(360_000);
  });

  test('REL-10-AC5: each other constant is the interfaces’ value: first look 290 s, a poll every 2 s, 90 s for the stand-down, a leftover at 10 minutes, a run limit of 10 minutes, a stop limit of 5 s', () => {
    expect({
      CANARY_FIRST_LOOK_MS,
      CANARY_POLL_MS,
      CANARY_STAND_DOWN_LIMIT_MS,
      CANARY_LEFTOVER_AFTER_MS,
      CANARY_RUN_LIMIT_MS,
      CANARY_STOP_LIMIT_MS,
    }).toEqual({
      CANARY_FIRST_LOOK_MS: 290_000,
      CANARY_POLL_MS: 2_000,
      CANARY_STAND_DOWN_LIMIT_MS: 90_000,
      CANARY_LEFTOVER_AFTER_MS: 600_000,
      CANARY_RUN_LIMIT_MS: 600_000,
      CANARY_STOP_LIMIT_MS: 5_000,
    });
  });

  test('REL-10-AC5: the first look comes before an alert could open: CANARY_FIRST_LOOK_MS is under LOST_CONTACT_AFTER_MS', () => {
    expect(CANARY_FIRST_LOOK_MS).toBeLessThan(LOST_CONTACT_AFTER_MS);
    expect(CANARY_FIRST_LOOK_MS).toBeLessThan(FIVE_MINUTES);
  });

  test('REL-10-AC5: the run limit is under the 15 minutes between runs, and above the longest run: the deadline, the stand-down limit and three requests’ timeouts', () => {
    const longestRun = CANARY_DEADLINE_MS + CANARY_STAND_DOWN_LIMIT_MS + 3 * REQUEST_TIMEOUT;

    expect(CANARY_RUN_LIMIT_MS).toBeLessThan(FIFTEEN_MINUTES);
    expect(CANARY_RUN_LIMIT_MS).toBeGreaterThan(longestRun);
  });

  test('REL-10-AC5: the deadline plus a request’s timeout is under LOST_CONTACT_AFTER_MS + ESCALATE_AFTER_MS, so the canary always ends its journey before its alert could escalate', () => {
    expect(CANARY_DEADLINE_MS + REQUEST_TIMEOUT).toBeLessThan(
      LOST_CONTACT_AFTER_MS + ESCALATE_AFTER_MS,
    );
    expect(CANARY_DEADLINE_MS + REQUEST_TIMEOUT).toBeLessThan(FIVE_MINUTES + TWO_MINUTES);
  });

  test('REL-10-AC5: a poll is short beside the slack, so polling can fail a run early by at most one poll and never pass it late', () => {
    expect(CANARY_POLL_MS).toBeGreaterThan(0);
    expect(CANARY_POLL_MS).toBeLessThan(ALERT_TIME_SLACK_MS);
    expect(CANARY_STOP_LIMIT_MS).toBeGreaterThan(0);
    expect(CANARY_STOP_LIMIT_MS).toBeLessThan(CANARY_RUN_LIMIT_MS);
  });
});

describe('REL-10: the outcomes and what each reports', () => {
  test('REL-10-AC5: CANARY_OUTCOMES is exactly the interfaces’ list, in its order, and the test kit’s copy of it', () => {
    expect(CANARY_OUTCOMES).toEqual([
      'ON_TIME',
      'NOT_CONFIGURED',
      'REGISTER_FAILED',
      'START_FAILED',
      'HEARTBEAT_FAILED',
      'READ_FAILED',
      'OPENED_EARLY',
      'NOT_OPENED',
      'NOT_HANDED_OVER',
      'HOME_FAILED',
      'NOT_RESOLVED',
      'ESCALATED',
      'STAND_DOWN_NOT_HANDED_OVER',
      'RUN_LIMIT',
      // RG-03 (REL-10 review loop 1, code-reviewer should-fix 4; D-128's
      // loop-1 amendment): RUN_FAILED is added, after RUN_LIMIT and before
      // INTERRUPTED, which stays last. A run that failed in a way no step
      // names (a programming fault, not a step's failure and not a halt) was
      // reported as RUN_LIMIT, which must mean the run reached
      // CANARY_RUN_LIMIT_MS and nothing else. Nothing else in the list moves.
      'RUN_FAILED',
      'INTERRUPTED',
    ]);
    expect(CANARY_OUTCOMES).toEqual(FAKE_CANARY_OUTCOMES);
  });

  test('REL-10-AC6: RUN_FAILED is reported failing, at once, and is not a missed alert (D-127): only NOT_OPENED and NOT_HANDED_OVER are', () => {
    expect(CANARY_OUTCOMES).toContain('RUN_FAILED');
    expect(reportFor('RUN_FAILED')).toBe('failing');
    expect(MISSED_ALERT_OUTCOMES).not.toContain('RUN_FAILED');
  });

  test('REL-10-AC5: MISSED_ALERT_OUTCOMES is exactly NOT_OPENED and NOT_HANDED_OVER: what D-022’s missed canary alert means for this canary (D-127)', () => {
    expect(MISSED_ALERT_OUTCOMES).toEqual(['NOT_OPENED', 'NOT_HANDED_OVER']);
  });

  test.each(CANARY_OUTCOMES.map((outcome: CanaryOutcome) => ({ outcome })))(
    'REL-10-AC5: reportFor($outcome) is ok for ON_TIME alone, null for INTERRUPTED alone, failing for every other',
    ({ outcome }) => {
      const expected = outcome === 'ON_TIME' ? 'ok' : outcome === 'INTERRUPTED' ? null : 'failing';

      expect(reportFor(outcome)).toBe(expected);
    },
  );
});

/**
 * The verdict the spec's approach item 6 gives, written out here: OPENED_EARLY
 * when the alert opened less than five minutes after last contact; else
 * NOT_OPENED with no opening; else NOT_HANDED_OVER with no answer, or one more
 * than five minutes plus 60 s after last contact; else ON_TIME, with both
 * durations.
 */
function expectedVerdict(lastContact: Date, openedAt: Date | null, answeredAt: Date | null) {
  const last = lastContact.getTime();
  if (openedAt !== null && openedAt.getTime() - last < FIVE_MINUTES) {
    return { outcome: 'OPENED_EARLY', openedAfterMs: openedAt.getTime() - last };
  }
  if (openedAt === null) {
    return { outcome: 'NOT_OPENED', openedAfterMs: null };
  }
  if (answeredAt === null || answeredAt.getTime() - last > FIVE_MINUTES + SLACK) {
    return { outcome: 'NOT_HANDED_OVER', openedAfterMs: openedAt.getTime() - last };
  }
  return {
    outcome: 'ON_TIME',
    alertMs: answeredAt.getTime() - last,
    openedAfterMs: openedAt.getTime() - last,
  };
}

describe('REL-10: the verdict, a pure rule on the database’s times', () => {
  test('REL-10-AC5: for any last contact, opening and answer, alertVerdict gives the spec’s outcome and durations, never throws, and changes nothing it was handed', () => {
    // Openings from a minute before last contact to ten minutes after it,
    // around the five-minute edge; answers from the opening on, around the
    // deadline; each also absent. A read cannot see the port's answer to an
    // alert that has not opened, so no answer comes before its opening.
    const moments = fc.record({
      lastContact: fc.date({
        min: new Date('2026-01-01T00:00:00.000Z'),
        max: new Date('2027-01-01T00:00:00.000Z'),
        noInvalidDate: true,
      }),
      openedAfterMs: fc.option(
        fc.oneof(
          fc.integer({ min: -MINUTE, max: 10 * MINUTE }),
          fc.constantFrom(FIVE_MINUTES - 1, FIVE_MINUTES, FIVE_MINUTES + 1),
        ),
        { nil: null },
      ),
      answerAfterOpeningMs: fc.option(
        fc.oneof(
          fc.integer({ min: 0, max: 3 * MINUTE }),
          fc.constantFrom(0, 1, SLACK - 1, SLACK, SLACK + 1),
        ),
        { nil: null },
      ),
    });

    fc.assert(
      fc.property(moments, ({ lastContact, openedAfterMs, answerAfterOpeningMs }) => {
        const openedAt =
          openedAfterMs === null ? null : new Date(lastContact.getTime() + openedAfterMs);
        const answeredAt =
          openedAt === null || answerAfterOpeningMs === null
            ? null
            : new Date(openedAt.getTime() + answerAfterOpeningMs);
        const given = { lastContact, openedAt, answeredAt };
        const times = [lastContact, openedAt, answeredAt].map((moment) => moment?.getTime());

        const verdict = alertVerdict(given);

        expect(verdict).toEqual(expectedVerdict(lastContact, openedAt, answeredAt));
        expect(
          [given.lastContact, given.openedAt, given.answeredAt].map((m) => m?.getTime()),
        ).toEqual(times);
        expect(given).toEqual({ lastContact, openedAt, answeredAt });
      }),
      { numRuns: 1_000 },
    );
  });

  test('REL-10-AC5: an answer with no opening is still NOT_OPENED: without an alert there is nothing it answered', () => {
    expect(
      alertVerdict({ lastContact: LAST_CONTACT, openedAt: null, answeredAt: after(FIVE_MINUTES) }),
    ).toEqual({ outcome: 'NOT_OPENED', openedAfterMs: null });
  });

  test('REL-10-AC3: an answer read at exactly last contact + 360 000 ms is ON_TIME; one first read at + 360 001 ms is NOT_HANDED_OVER, with the opening’s duration', () => {
    expect(
      alertVerdict({
        lastContact: LAST_CONTACT,
        openedAt: after(FIVE_MINUTES),
        answeredAt: after(360_000),
      }),
    ).toEqual({ outcome: 'ON_TIME', alertMs: 360_000, openedAfterMs: 300_000 });
    expect(
      alertVerdict({
        lastContact: LAST_CONTACT,
        openedAt: after(FIVE_MINUTES),
        answeredAt: after(360_001),
      }),
    ).toEqual({ outcome: 'NOT_HANDED_OVER', openedAfterMs: 300_000 });
  });

  test('REL-10-AC3: an alert that opened but was never answered is NOT_HANDED_OVER, with the opening’s duration', () => {
    expect(
      alertVerdict({
        lastContact: LAST_CONTACT,
        openedAt: after(FIVE_MINUTES + 20 * SECOND),
        answeredAt: null,
      }),
    ).toEqual({ outcome: 'NOT_HANDED_OVER', openedAfterMs: 320_000 });
  });

  test('REL-10-AC4: an alert opened at last contact + 4 minutes is OPENED_EARLY, answered in time or not', () => {
    for (const answeredAt of [null, after(4 * MINUTE + 1), after(FIVE_MINUTES)]) {
      expect(
        alertVerdict({ lastContact: LAST_CONTACT, openedAt: after(4 * MINUTE), answeredAt }),
      ).toEqual({ outcome: 'OPENED_EARLY', openedAfterMs: 240_000 });
    }
  });

  test('REL-10-AC4: an opening at exactly + 300 000 ms is not early; one at + 299 999 ms is', () => {
    expect(
      alertVerdict({
        lastContact: LAST_CONTACT,
        openedAt: after(300_000),
        answeredAt: after(300_000),
      }),
    ).toEqual({ outcome: 'ON_TIME', alertMs: 300_000, openedAfterMs: 300_000 });
    expect(
      alertVerdict({ lastContact: LAST_CONTACT, openedAt: after(300_000), answeredAt: null }),
    ).toEqual({ outcome: 'NOT_HANDED_OVER', openedAfterMs: 300_000 });
    expect(
      alertVerdict({
        lastContact: LAST_CONTACT,
        openedAt: after(299_999),
        answeredAt: after(300_000),
      }),
    ).toEqual({ outcome: 'OPENED_EARLY', openedAfterMs: 299_999 });
  });

  test('REL-10-AC1: an alert on time carries both durations, from last contact: the answer’s and the opening’s', () => {
    expect(
      alertVerdict({
        lastContact: LAST_CONTACT,
        openedAt: after(FIVE_MINUTES + 7 * SECOND),
        answeredAt: after(FIVE_MINUTES + 9 * SECOND),
      }),
    ).toEqual({ outcome: 'ON_TIME', alertMs: 309_000, openedAfterMs: 307_000 });
  });
});

describe('REL-10: the leftover rule', () => {
  test('REL-10-AC8: a canary journey started 10 minutes or more ago by the database’s clock is a leftover; one started less than 10 minutes ago is a run in flight', () => {
    const now = after(30 * MINUTE);
    const startedAgo = (ms: number) => ({ startedAt: new Date(now.getTime() - ms), now });

    expect(isLeftover(startedAgo(600_000))).toBe(true);
    expect(isLeftover(startedAgo(600_001))).toBe(true);
    expect(isLeftover(startedAgo(599_999))).toBe(false);
    expect(isLeftover(startedAgo(0))).toBe(false);
  });

  test('REL-10-AC8: for any start and now, isLeftover is true exactly when the start is 10 minutes or more before now, and changes nothing it was handed', () => {
    fc.assert(
      fc.property(
        fc.date({
          min: new Date('2026-01-01T00:00:00.000Z'),
          max: new Date('2027-01-01T00:00:00.000Z'),
          noInvalidDate: true,
        }),
        fc.oneof(
          fc.integer({ min: -MINUTE, max: 30 * MINUTE }),
          fc.constantFrom(10 * MINUTE - 1, 10 * MINUTE, 10 * MINUTE + 1),
        ),
        (now, agoMs) => {
          const startedAt = new Date(now.getTime() - agoMs);
          const given = { startedAt, now };

          expect(isLeftover(given)).toBe(agoMs >= 10 * MINUTE);
          expect([given.startedAt.getTime(), given.now.getTime()]).toEqual([
            now.getTime() - agoMs,
            now.getTime(),
          ]);
        },
      ),
      { numRuns: 1_000 },
    );
  });
});
