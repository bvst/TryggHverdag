// req-coverage: fixtures-only — this tests the test kit, not a requirement.
//
// The heartbeat system tests prove "logged without location" and "one line
// per failure" by what this fake recorded. A fake that dropped an event,
// merged two, kept only some of an event's fields, or let a test change what
// it had recorded would make those tests pass whatever the module logged.
import { describe, expect, test } from 'vitest';
import { fakeLog, type FakeLogEvent } from './fake-log.ts';
import * as kit from './index.ts';
import { syntheticUuid } from './synthetic-ids.ts';

describe('fakeLog', () => {
  test('records nothing until something is written', () => {
    expect(fakeLog().events).toEqual([]);
  });

  test('records every event written, in order, each exactly as given', () => {
    const log = fakeLog();
    const journeyId = syntheticUuid();
    const written: FakeLogEvent[] = [
      { event: 'heartbeat_ignored', reason: 'JOURNEY_ENDED', journeyId },
      { event: 'heartbeat_failed', stage: 'store', code: '23514' },
      { event: 'heartbeat_failed', stage: 'clock', code: null },
      { event: 'heartbeat_ignored', reason: 'JOURNEY_ENDED', journeyId },
    ];

    for (const event of written) {
      log.write(event);
    }

    expect(log.events).toEqual(written);
  });

  test('keeps every field an event was given, so one that carried more than its type allows still shows', () => {
    const log = fakeLog();
    const carrying = {
      event: 'heartbeat_failed',
      stage: 'store',
      code: null,
      latitude: 0.5,
    } as unknown as FakeLogEvent;

    log.write(carrying);

    expect(log.events).toEqual([carrying]);
    expect(JSON.stringify(log.events)).toContain('latitude');
  });

  test('what it hands back, and what it was given, cannot change what it recorded', () => {
    const log = fakeLog();
    const journeyId = syntheticUuid();
    const event = { event: 'heartbeat_ignored', reason: 'JOURNEY_ENDED', journeyId } as const;
    const given: { -readonly [K in keyof typeof event]: string } = { ...event };
    log.write(given as FakeLogEvent);

    given.journeyId = syntheticUuid();
    const handedOut = log.events[0] as { journeyId: string } | undefined;
    if (handedOut !== undefined) {
      handedOut.journeyId = syntheticUuid();
    }

    expect(log.events).toEqual([event]);
  });

  test('records the watchdog’s, the sender’s and the pools’ events too, each exactly as given (LOST-02)', () => {
    const log = fakeLog();
    const written: FakeLogEvent[] = [
      { event: 'watchdog_failed', stage: 'open', code: '40P01' },
      { event: 'watchdog_overdue', journeyId: syntheticUuid() },
      { event: 'push_failed', reason: 'NO_TARGET', messageId: syntheticUuid() },
      { event: 'delivery_failed', stage: 'claim', code: null },
      { event: 'database_error', pool: 'worker', code: '25P03' },
    ];

    for (const event of written) {
      log.write(event);
    }

    expect(log.events).toEqual(written);
  });

  test('records the "I’m home" events and the missing alert too, each exactly as given (LOST-03)', () => {
    const log = fakeLog();
    const written: FakeLogEvent[] = [
      { event: 'home_ignored', reason: 'JOURNEY_ENDED', journeyId: syntheticUuid() },
      { event: 'home_failed', stage: 'read', code: '57P01' },
      { event: 'home_failed', stage: 'store', code: null },
      { event: 'alert_missing', journeyId: syntheticUuid() },
    ];

    for (const event of written) {
      log.write(event);
    }

    expect(log.events).toEqual(written);
  });

  test('records the "I’m on it" events too, each exactly as given (LOST-06)', () => {
    const log = fakeLog();
    const written: FakeLogEvent[] = [
      { event: 'acknowledgement_ignored', reason: 'ALERT_RESOLVED', alertId: syntheticUuid() },
      { event: 'acknowledgement_failed', stage: 'read', code: '57P01' },
      { event: 'acknowledgement_failed', stage: 'store', code: null },
    ];

    for (const event of written) {
      log.write(event);
    }

    expect(log.events).toEqual(written);
  });

  test('the test kit hands it out', () => {
    expect(kit.fakeLog).toBe(fakeLog);
  });
});
