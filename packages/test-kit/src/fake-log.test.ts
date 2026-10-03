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

  test('the test kit hands it out', () => {
    expect(kit.fakeLog).toBe(fakeLog);
  });
});
