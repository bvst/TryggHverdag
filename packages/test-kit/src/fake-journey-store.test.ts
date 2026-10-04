// req-coverage: fixtures-only — this tests the test kit, not a requirement.
//
// The journey system tests prove the start and heartbeat rules by what this
// fake stores and refuses. A fake that let a walker hold two unended journeys,
// stored half a start or half a heartbeat, counted a resent event twice, let
// last contact run backwards, or could not fail would not go red: it would
// make those tests pass whatever the server did. The shared behaviour suite
// below is the same one the real adapter runs against PostgreSQL, so the two
// cannot drift apart.
import { describe, expect, test } from 'vitest';
import { fakeClock } from './fake-clock.ts';
import {
  fakeJourneyStore,
  type FakeJourneyStore,
  type StartedJourney,
} from './fake-journey-store.ts';
import * as kit from './index.ts';
import {
  JOURNEY_STORE_BEHAVIOUR,
  RACE_ROUNDS,
  RACERS,
  type JourneyStoreUnderTest,
} from './journey-store-behaviour.ts';
import { syntheticEventId, syntheticPosition, toStoredPosition } from './synthetic-heartbeats.ts';
import { syntheticUuid } from './synthetic-ids.ts';

const AT = new Date('2026-10-01T21:00:00.000Z');

/** Runs of each fast-check property in the shared suite: fast-check's own default, as the fake is fast. */
const PROPERTY_RUNS = 100;

/** Where the fake's clock stands for the shared suite: a synthetic night (LOST-02). */
const CLOCK_AT = new Date('2026-10-01T23:00:00.000Z');

function underTest(): JourneyStoreUnderTest {
  // LOST-02: the watchdog and the outbox ask the store about time, so the
  // fake the suite runs against is given a clock. It stands still: the
  // suite's times are read from it, and its margin is 0, so the suite asks
  // about the five-minute threshold itself, to the millisecond.
  const clock = fakeClock(CLOCK_AT);
  const store = fakeJourneyStore({ clock });
  const knownJourney = (journeyId: string) =>
    store.journeys().some((journey) => journey.id === journeyId.toLowerCase());
  const heartbeatsOf = (journeyId: string) =>
    store.heartbeats().filter((heartbeat) => heartbeat.journeyId === journeyId.toLowerCase());
  const alertsOf = (journeyId: string) =>
    store.alerts().filter((alert) => alert.journeyId === journeyId.toLowerCase());
  return {
    now: () => clock.now(),
    alertsOf: (journeyId) =>
      Promise.resolve(
        alertsOf(journeyId).map(({ id, state, openedAt, silentSince }) => ({
          id,
          state,
          openedAt,
          silentSince,
        })),
      ),
    messagesOf: (journeyId) => {
      const alertIds = alertsOf(journeyId).map(({ id }) => id);
      return Promise.resolve(
        store
          .outbox()
          .filter(({ alertId }) => alertIds.includes(alertId))
          .map(
            ({
              messageId,
              alertId,
              recipientId,
              kind,
              attempts,
              nextAttemptAt,
              sentAt,
              lastFailure,
            }) => ({
              messageId,
              alertId,
              recipientId,
              kind,
              attempts,
              nextAttemptAt,
              sentAt,
              lastFailure,
            }),
          ),
      );
    },
    hold: (journeyId) => {
      store.hold(journeyId);
      return Promise.resolve({
        release: () => {
          store.release(journeyId);
          return Promise.resolve();
        },
      });
    },
    // LOST-02-AC20: a holder that lets go when an open waits for it, after
    // contact came, as a heartbeat in flight brings it, or with nothing changed.
    holdUntilWaited: (journeyId, change) => {
      store.holdUntilWaited(journeyId, async () => {
        if (change === 'contact') {
          await store.recordHeartbeat({
            journeyId,
            eventId: syntheticEventId(),
            receivedAt: await clock.now(),
            batteryLevel: null,
            position: null,
          });
        }
      });
      return Promise.resolve({
        release: () => {
          store.release(journeyId);
          return Promise.resolve();
        },
      });
    },
    // The fake waits for nothing, so any wait does.
    lockWaitMs: 5_000,
    timeMarginMs: 0,
    store,
    addUser: () => Promise.resolve(store.addUser()),
    addDevice: (userId) => Promise.resolve(store.addDevice(userId)),
    seedJourney: (journey) => Promise.resolve(store.seed(journey)),
    journeysOf: (walkerId) =>
      Promise.resolve(store.journeys().filter((journey) => journey.walkerId === walkerId)),
    endJourney: (journeyId) => {
      store.setState(journeyId, 'ENDED');
      return Promise.resolve();
    },
    deviceOf: (journeyId) =>
      Promise.resolve(knownJourney(journeyId) ? store.deviceOf(journeyId) : null),
    stateOf: (journeyId) =>
      Promise.resolve(
        store.journeys().find((journey) => journey.id === journeyId.toLowerCase())?.state ?? null,
      ),
    lastHeartbeatAt: (journeyId) => Promise.resolve(store.lastHeartbeatAt(journeyId)),
    heartbeatsOf: (journeyId) =>
      Promise.resolve(
        heartbeatsOf(journeyId).map(({ eventId, receivedAt, batteryLevel }) => ({
          eventId,
          receivedAt,
          batteryLevel,
        })),
      ),
    positionsOf: (journeyId) => {
      const mine = heartbeatsOf(journeyId);
      return Promise.resolve(
        store.positions().flatMap(({ heartbeatId, ...position }) => {
          const heartbeat = mine.find((candidate) => candidate.id === heartbeatId);
          return heartbeat === undefined ? [] : [{ eventId: heartbeat.eventId, ...position }];
        }),
      );
    },
    propertyRuns: PROPERTY_RUNS,
  };
}

/** A store with one user who has one device: someone who can start a journey. */
function withWalker(): { store: FakeJourneyStore; walkerId: string; deviceId: string } {
  const store = fakeJourneyStore();
  const walkerId = store.addUser();
  return { store, walkerId, deviceId: store.addDevice(walkerId) };
}

describe('fakeJourneyStore, against the behaviour every journey store shares', () => {
  test('the shared suite is the list the adapter runs too; a case removed shows here', () => {
    expect(JOURNEY_STORE_BEHAVIOUR.map((behaviour) => behaviour.name)).toEqual([
      'a walker with no journey has no unended journey',
      'a start is stored ACTIVE, with exactly its responders and the moment it was given',
      'a journey in ACTIVE or in LOST_CONTACT is reported as unended, with its ID and state',
      'an ENDED journey is never reported as unended',
      'a start beside an unended journey is not inserted, names that journey, and changes nothing',
      'an ENDED journey does not block a new one, and stays exactly as it was',
      'one walker’s unended journey does not block another walker',
      'starts racing for one walker, 10 at once and 5 times over: exactly one is inserted, and every other names it',
      'existingUsers names exactly the given IDs that are users',
      'an ID in upper case finds the same user and the same journey, and every ID comes back lower-case',
      'a responder who is not a user is refused whole: the store rejects, and leaves no journey',
      'a walker who is not a user is refused: the store rejects, and stores nothing',
      'a start with no responders is refused, and stores nothing',
      'a start with no responders beside an unended journey is refused too, never answered as not inserted, and changes nothing',
      'LOST-01-AC10: a start stores the device it was given, and no other (D-101)',
      'a start naming a device that does not exist is refused: the store rejects, and stores nothing (D-101)',
      'LOST-01-AC9: journeyForHeartbeat names the journey’s walker, its starting device and its state, in every state, ENDED included, in either case; and null for an ID no journey has',
      'LOST-01-AC1: a heartbeat with a position is recorded once: its receive time and battery, its position exactly as given with the phone’s time, last contact at its receive time, and the journey still ACTIVE',
      'LOST-01-AC2: a journey with no heartbeat has no latest heartbeat and no last contact',
      'LOST-01-AC2: a heartbeat without a position, battery unknown, is recorded the same with no position stored, and the latest reads no position until one with a position comes',
      'LOST-01-AC3: an event ID the journey already has is a duplicate, with the same content or another, however late: nothing changes, last contact included',
      'LOST-01-AC3: an event ID belongs to its journey: the same ID for another journey is recorded there, and changes nothing here',
      'LOST-01-AC3: event IDs are compared exactly, case and all: one that differs only in case is another event',
      'LOST-01-AC4: 10 copies of one heartbeat at once, 5 times over: exactly one is recorded and every other is a duplicate, none an error, leaving one heartbeat and one position',
      'LOST-01-AC5: for any receive times, written in any order, last contact is the greatest so far after every write and never moves backwards; the latest heartbeat is the one with the greatest receive time, a tie to the one stored last; and each is stored exactly once',
      'LOST-01-AC5: 10 heartbeats written at once, started in an order unrelated to their receive times: last contact is the greatest receive time, and each is stored once',
      'LOST-01-AC5: a heartbeat received before the journey’s last contact is stored, and last contact stays where it was',
      'LOST-01-AC6: the phone’s time is stored as given, hours ahead of the receive time or hours behind it, and last contact and the latest heartbeat follow the receive times only',
      'LOST-01-AC7: a heartbeat for a journey already ENDED in the store is answered ended, with a position or without: nothing is stored, and last contact is unchanged',
      'LOST-01-AC7: once a journey has ended, even an event ID it already has is answered ended, not duplicate, and nothing it holds changes',
      'LOST-01-AC8: a heartbeat for a journey in LOST_CONTACT is recorded and advances last contact, and the journey stays LOST_CONTACT',
      'LOST-01-AC13: a heartbeat whose position is refused leaves nothing behind: no heartbeat, no position, last contact unchanged; and the same event is then recorded, not a duplicate',
      'LOST-01-AC18: a latitude, longitude, accuracy, battery level or event ID outside the contract’s rules is refused by the store, and nothing is stored',
      'LOST-01-AC18: the boundaries are accepted: latitude ±90, longitude ±180, accuracy 0, battery 0 and 1, and an event ID of 64 characters',
      // RG-03: the two below were added after LOST-01's reviews (safety and
      // code review): the contract now bounds the phone's time to the years
      // 0001 to 9999 in UTC, as PostgreSQL does, and the fake refuses what
      // the database refuses (D-100). Nothing was removed from this list.
      'LOST-01-AC18: a phone time whose instant in UTC falls outside the years 0001 to 9999 is refused by the store, as PostgreSQL refuses it, and nothing is stored; the same event with a phone time inside them is then recorded',
      'LOST-01-AC18: the first and the last instant of the years 0001 to 9999 in UTC are accepted as phone times, and stored exactly as given',
      'a heartbeat for a journey that does not exist is refused: the store rejects, and stores nothing',
      // RG-03 (LOST-02): the watchdog's and the outbox's behaviours join the
      // shared suite, as the spec's test plan says ("one behaviour, two
      // implementations"), so the fake and the adapter are held to them
      // alike (D-100). Every name above is unchanged; these are added.
      'LOST-02-AC2: the overdue read returns exactly the ACTIVE journeys silent for five minutes or more, counted from last contact, or from the start when there is none, each with when its silence began, and the store’s now; and now when nothing is overdue',
      'LOST-02-AC2: for any journeys, in any state, silent for any time, with or without a heartbeat, one sweep moves exactly the ACTIVE ones silent five minutes or more to LOST_CONTACT, each with one OPEN alert silent since its silence began, and leaves every other one as it was',
      'LOST-02-AC2: for any sequence of heartbeats, received in any order, and sweeps between them, a journey is LOST_CONTACT after a sweep exactly when some sweep so far found it silent five minutes or more, and a heartbeat after that does not move it back',
      'LOST-02-AC3: a journey that never sent a heartbeat is timed from its start: not overdue a moment before five minutes have passed since it, overdue at five minutes, and its alert is silent since its start',
      'LOST-02-AC9: opening moves an overdue ACTIVE journey to LOST_CONTACT, with one OPEN alert opened at the store’s now and silent since its last contact, and one LOST_CONTACT message per responder, each with a fresh ID, not sent and due at once; the walker gets none',
      'LOST-02-AC9: opening skips, and writes nothing, for a journey not yet overdue, already LOST_CONTACT, ENDED, or not there at all',
      'LOST-02-AC9: contact stored between the overdue read and the open wins: the open skips and writes nothing, and the journey stays ACTIVE; and a journey whose state changed in between is skipped too',
      'LOST-02-AC5: a journey already alerted is never opened again: a second open skips, and it keeps its one alert and its messages as they were',
      'LOST-02-AC12: a journey with no responder rows is never moved: the open rejects, and it stays ACTIVE with no alert and no message',
      'LOST-02-AC8: a journey whose row another transaction holds is skipped at once, not waited for, and changes nothing; once released, it is opened',
      // RG-03 (LOST-02, settled after the red phase): an open that waits for
      // a held row joins the shared suite (approach item 3, step 4; AC20).
      // Every other name is unchanged; this one is added.
      'LOST-02-AC20: an open with a lock wait answers held when the row stays held, opened when it is let go unchanged, and skipped when it is let go no longer overdue',
      'LOST-02-AC7: 10 opens racing for one overdue journey, 5 times over: exactly one opens and every other skips, none an error; one alert, and one message per responder',
      'LOST-02-AC14: a claim hands out each due message once: one attempt counted, leased until the claim’s now plus the lease, and not handed out again while the lease runs',
      'LOST-02-AC14: a claim takes at most its limit, and the next claim takes the rest',
      'LOST-02-AC7: 10 claims racing: each due message is handed to exactly one of them',
      'LOST-02-AC15: a failed message keeps its reason and is due again after the delay given, with the same ID and one more attempt; a sent one is marked at the store’s now, and never handed out again',
      'LOST-02-AC15: a failure reason outside the push port’s four is refused, and the message is left as it was',
      'LOST-02-AC13: the heartbeat received at the alert’s silent_since is the journey’s latest, with its battery level and whether it had a position',
    ]);
    expect(RACERS).toBeGreaterThanOrEqual(10);
    expect(RACE_ROUNDS).toBeGreaterThanOrEqual(5);
  });

  test.each(JOURNEY_STORE_BEHAVIOUR)('$name', async ({ run }) => {
    await run(underTest());
  });
});

// ---------------------------------------------------------------------------
// The phone-time range, under zones other than UTC (test-auditor, LOST-01
// loop 1). CI and the cloud session run in UTC, where a year read in local
// time and one read in UTC are the same, so a fake that read the local year
// passed the two range behaviours above. Run again under a zone east of UTC
// and one west of it, an edge moves either way:
//   - Europe/Oslo, the app's own: +01:00 at the end of 9999, and +00:53, its
//     local mean time, in year 0, so both ends move forward a year;
//   - Etc/GMT+12, twelve hours behind UTC at every date (the sign is POSIX's,
//     the opposite of ISO's), so the start of 0001 moves back into year 0.
// A zone Node does not know is taken as UTC without a word, so each run first
// checks that its zone moved its edge. The test kit has no Node types, so the
// process's environment is reached through globalThis, typed by what is used.
// ---------------------------------------------------------------------------

const ZONES_THAT_MOVE_AN_EDGE = [
  { zone: 'Europe/Oslo', edge: '9999-12-31T23:59:59Z', utcYear: 9999, yearInZone: 10000 },
  { zone: 'Etc/GMT+12', edge: '0001-01-01T00:00:00Z', utcYear: 1, yearInZone: 0 },
];

/** The process's environment: the one variable these tests change. */
const environment = (globalThis as unknown as { process: { env: { TZ?: string } } }).process.env;

/**
 * Runs `run` with the process in this time zone, then puts the zone back as
 * it was, whether `run` resolved or rejected. Node applies a change to TZ at
 * once, to every Date read after it.
 */
async function inTimeZone(zone: string, run: () => Promise<void>): Promise<void> {
  const before = environment.TZ;
  environment.TZ = zone;
  try {
    await run();
  } finally {
    if (before === undefined) {
      delete environment.TZ;
    } else {
      environment.TZ = before;
    }
  }
}

/** What the range behaviours' names start with: the criterion they hold. */
const RANGE_CRITERION = 'LOST-01-AC18: ';

/** The shared behaviours about the phone-time range: the ones a zone could change. */
const PHONE_TIME_RANGE = JOURNEY_STORE_BEHAVIOUR.filter(({ name }) =>
  name.includes('the years 0001 to 9999'),
);

describe('fakeJourneyStore reads the phone-time range in UTC, whatever zone the process runs in', () => {
  test('LOST-01-AC18: (control) the range behaviours are found, both of them, so the runs below are not empty', () => {
    expect(PHONE_TIME_RANGE.map(({ name }) => name)).toEqual([
      'LOST-01-AC18: a phone time whose instant in UTC falls outside the years 0001 to 9999 is refused by the store, as PostgreSQL refuses it, and nothing is stored; the same event with a phone time inside them is then recorded',
      'LOST-01-AC18: the first and the last instant of the years 0001 to 9999 in UTC are accepted as phone times, and stored exactly as given',
    ]);
  });

  test.each(
    ZONES_THAT_MOVE_AN_EDGE.flatMap((zone) =>
      PHONE_TIME_RANGE.map(({ name, run }) => ({
        ...zone,
        behaviour: name.slice(RANGE_CRITERION.length),
        run,
      })),
    ),
  )(
    'LOST-01-AC18: under $zone, as in UTC: $behaviour',
    async ({ zone, edge, utcYear, yearInZone, run }) => {
      await inTimeZone(zone, async () => {
        // Control: the zone is in effect, and the year read in it differs at this edge.
        expect(new Date(edge).getUTCFullYear(), edge).toBe(utcYear);
        expect(new Date(edge).getFullYear(), `${edge} in ${zone}`).toBe(yearInZone);

        await run(underTest());
      });
    },
  );

  test('LOST-01-AC18: (control) each zone is put back afterwards, whether the run passed or failed, so no other test runs in it', async () => {
    const before = environment.TZ;
    const yearBefore = new Date('9999-12-31T23:59:59Z').getFullYear();

    for (const { zone } of ZONES_THAT_MOVE_AN_EDGE) {
      await inTimeZone(zone, () => Promise.resolve());
      await expect(
        inTimeZone(zone, () => Promise.reject(new Error('the run failed'))),
      ).rejects.toThrow('the run failed');
    }

    expect(environment.TZ).toBe(before);
    expect(new Date('9999-12-31T23:59:59Z').getFullYear()).toBe(yearBefore);
  });
});

describe('fakeJourneyStore, beyond the shared suite', () => {
  test('seeds a journey in any state, and hands back what it stored', () => {
    const { store, walkerId, deviceId } = withWalker();
    const responderId = store.addUser();

    const ended = store.seed({
      walkerId,
      deviceId,
      state: 'ENDED',
      responderIds: [responderId],
      startedAt: AT,
    });
    const lost = store.seed({
      walkerId,
      deviceId,
      state: 'LOST_CONTACT',
      responderIds: [responderId],
      startedAt: AT,
    });

    expect(store.journeys()).toEqual([
      { id: ended, walkerId, state: 'ENDED', startedAt: AT, responderIds: [responderId] },
      { id: lost, walkerId, state: 'LOST_CONTACT', startedAt: AT, responderIds: [responderId] },
    ]);
  });

  test('seeds with the ID a test gives, and refuses one already used', () => {
    const { store, walkerId, deviceId } = withWalker();
    const id = syntheticUuid();

    expect(
      store.seed({ walkerId, deviceId, state: 'ENDED', responderIds: [], startedAt: AT, id }),
    ).toBe(id);
    expect(() =>
      store.seed({ walkerId, deviceId, state: 'ENDED', responderIds: [], startedAt: AT, id }),
    ).toThrow(/already stored/);
  });

  test('refuses to seed a second unended journey, as the partial unique index would', () => {
    const { store, walkerId, deviceId } = withWalker();
    store.seed({ walkerId, deviceId, state: 'ACTIVE', responderIds: [], startedAt: AT });

    expect(() =>
      store.seed({ walkerId, deviceId, state: 'LOST_CONTACT', responderIds: [], startedAt: AT }),
    ).toThrow(/partial unique index/);
    expect(store.journeys()).toHaveLength(1);
  });

  test('refuses to seed for a walker or a responder who is not a user, as the foreign keys would', () => {
    const { store, walkerId, deviceId } = withWalker();

    expect(() =>
      store.seed({
        walkerId: syntheticUuid(),
        deviceId,
        state: 'ENDED',
        responderIds: [],
        startedAt: AT,
      }),
    ).toThrow(/foreign key/);
    expect(() =>
      store.seed({
        walkerId,
        deviceId,
        state: 'ENDED',
        responderIds: [syntheticUuid()],
        startedAt: AT,
      }),
    ).toThrow(/foreign key/);
    expect(store.journeys()).toEqual([]);
  });

  test('addUser uses the ID a test gives, or makes a fresh one', async () => {
    const store = fakeJourneyStore();
    const given = syntheticUuid();

    expect(store.addUser(given)).toBe(given);
    const made = store.addUser();

    expect(made).not.toBe(given);
    expect([...(await store.existingUsers([given, made]))].sort()).toEqual([given, made].sort());
  });

  test('records each port method called, in order, and nothing for its own test helpers', async () => {
    const { store, walkerId, deviceId } = withWalker();
    const responderId = store.addUser();
    store.seed({ walkerId, deviceId, state: 'ENDED', responderIds: [], startedAt: AT });
    store.journeys();
    expect(store.calls).toEqual([]);

    await store.unendedJourneyOf(walkerId);
    await store.existingUsers([walkerId]);
    await store.insertStarted({ walkerId, deviceId, responderIds: [responderId], startedAt: AT });

    expect(store.calls).toEqual(['unendedJourneyOf', 'existingUsers', 'insertStarted']);
  });

  test('while failing, every port method rejects with exactly the error given, and changes nothing', async () => {
    const { store, walkerId, deviceId } = withWalker();
    const error = new Error('the database did not answer');
    store.failWith(error);

    await expect(store.unendedJourneyOf(walkerId)).rejects.toBe(error);
    await expect(store.existingUsers([walkerId])).rejects.toBe(error);
    await expect(
      store.insertStarted({ walkerId, deviceId, responderIds: [], startedAt: AT }),
    ).rejects.toBe(error);

    expect(store.journeys()).toEqual([]);
    expect(store.calls).toEqual(['unendedJourneyOf', 'existingUsers', 'insertStarted']);
  });

  test('answers again after recovering', async () => {
    const { store, walkerId, deviceId } = withWalker();
    const responderId = store.addUser();
    store.failWith(new Error('the database did not answer'));

    store.recover();

    const result = await store.insertStarted({
      walkerId,
      deviceId,
      responderIds: [responderId],
      startedAt: AT,
    });
    expect(result.inserted).toBe(true);
  });

  test('a start counts as stored only once it has settled, not when it is asked for', async () => {
    const { store, walkerId, deviceId } = withWalker();
    const responderId = store.addUser();

    const storing = store.insertStarted({
      walkerId,
      deviceId,
      responderIds: [responderId],
      startedAt: AT,
    });
    expect(store.journeys()).toEqual([]);

    await storing;
    expect(store.journeys()).toHaveLength(1);
  });

  test('stores the responders it is given, repeats included, so a caller that forgot to drop them shows', async () => {
    const { store, walkerId, deviceId } = withWalker();
    const responderId = store.addUser();

    await store.insertStarted({
      walkerId,
      deviceId,
      responderIds: [responderId, responderId],
      startedAt: AT,
    });

    expect(store.journeys()[0]?.responderIds).toEqual([responderId, responderId]);
  });

  test('what it hands back cannot change what it holds', async () => {
    const { store, walkerId, deviceId } = withWalker();
    const responderId = store.addUser();
    const startedAt = new Date(AT.getTime());
    const responderIds = [responderId];
    await store.insertStarted({ walkerId, deviceId, responderIds, startedAt });

    startedAt.setTime(0);
    responderIds.push(walkerId);
    const handedOut = store.journeys()[0];
    handedOut?.startedAt.setTime(0);

    expect(store.journeys()).toEqual([
      expect.objectContaining({ startedAt: AT, responderIds: [responderId] }),
    ]);
  });

  test('holds IDs given in upper case as lower-case, as a uuid column does', () => {
    const store = fakeJourneyStore();
    const given = syntheticUuid();
    const responderId = syntheticUuid();

    expect(store.addUser(given.toUpperCase())).toBe(given);
    store.addUser(responderId.toUpperCase());
    const deviceId = store.addDevice(given);
    const journeyId = syntheticUuid();
    store.seed({
      walkerId: given.toUpperCase(),
      deviceId,
      state: 'ENDED',
      responderIds: [responderId.toUpperCase()],
      startedAt: AT,
      id: journeyId.toUpperCase(),
    });

    expect(store.journeys()).toEqual([
      {
        id: journeyId,
        walkerId: given,
        state: 'ENDED',
        startedAt: AT,
        responderIds: [responderId],
      },
    ]);
  });

  test('the test kit hands out the fake and the shared suite', () => {
    expect(kit.fakeJourneyStore).toBe(fakeJourneyStore);
    expect(kit.JOURNEY_STORE_BEHAVIOUR).toBe(JOURNEY_STORE_BEHAVIOUR);
  });
});

/** A heartbeat for the store, with a synthetic position, received at AT (a copy) unless given. */
function heartbeat(journeyId: string, receivedAt = new Date(AT.getTime())) {
  return {
    journeyId,
    eventId: syntheticEventId(),
    receivedAt,
    batteryLevel: 0.734375,
    position: toStoredPosition(syntheticPosition()),
  };
}

describe('fakeJourneyStore: the device a journey starts from (D-101) and its heartbeats (LOST-01)', () => {
  test('addDevice uses the ID a test gives, lower-cased, or makes a fresh one, and refuses a user who does not exist or an ID already used', () => {
    const store = fakeJourneyStore();
    const userId = store.addUser();
    const given = syntheticUuid();

    expect(store.addDevice(userId, given.toUpperCase())).toBe(given);
    const made = store.addDevice(userId);
    expect(made).not.toBe(given);
    expect(made).toBe(made.toLowerCase());
    expect(() => store.addDevice(syntheticUuid())).toThrow(/foreign key/);
    expect(() => store.addDevice(userId, given)).toThrow(/already stored/);
  });

  test('refuses to seed, or to store a start, with a device that does not exist, as the foreign key would', async () => {
    const { store, walkerId } = withWalker();
    const responderId = store.addUser();

    expect(() =>
      store.seed({
        walkerId,
        deviceId: syntheticUuid(),
        state: 'ACTIVE',
        responderIds: [],
        startedAt: AT,
      }),
    ).toThrow(/foreign key/);
    await expect(
      store.insertStarted({
        walkerId,
        deviceId: syntheticUuid(),
        responderIds: [responderId],
        startedAt: AT,
      }),
    ).rejects.toThrow(/foreign key/);
    expect(store.journeys()).toEqual([]);
  });

  test('refuses a start or a seed that names no device, as device_id’s NOT NULL would, beside an unended journey too', async () => {
    const { store, walkerId, deviceId } = withWalker();
    const responderId = store.addUser();
    // A start as a caller that forgot the device would hand it over: typed as
    // what it is, then cast to the port's parameter type, as such a caller's
    // own types would have let it through. The fake must refuse it at run time.
    const noDevice: Omit<StartedJourney, 'deviceId'> = {
      walkerId,
      responderIds: [responderId],
      startedAt: AT,
    };
    const seedWithNoDevice = { ...noDevice, state: 'ENDED' } as Parameters<
      FakeJourneyStore['seed']
    >[0];

    await expect(store.insertStarted(noDevice as StartedJourney)).rejects.toThrow(/not-null/);
    expect(() => store.seed(seedWithNoDevice)).toThrow(/not-null/);
    store.seed({ walkerId, deviceId, state: 'ACTIVE', responderIds: [], startedAt: AT });
    await expect(store.insertStarted(noDevice as StartedJourney)).rejects.toThrow(/not-null/);
    expect(store.journeys()).toHaveLength(1);
  });

  test('a start beside an unended journey is not inserted even with a device that does not exist, as ON CONFLICT DO NOTHING checks no foreign key', async () => {
    const { store, walkerId, deviceId } = withWalker();
    const responderId = store.addUser();
    const journeyId = store.seed({
      walkerId,
      deviceId,
      state: 'ACTIVE',
      responderIds: [responderId],
      startedAt: AT,
    });

    await expect(
      store.insertStarted({
        walkerId,
        deviceId: syntheticUuid(),
        responderIds: [responderId],
        startedAt: AT,
      }),
    ).resolves.toEqual({ inserted: false, unendedJourneyId: journeyId });
  });

  test('deviceOf and lastHeartbeatAt read what was seeded or stored, and throw for a journey never stored', async () => {
    const { store, walkerId, deviceId } = withWalker();
    const responderId = store.addUser();
    const seeded = store.seed({
      walkerId,
      deviceId,
      state: 'ENDED',
      responderIds: [],
      startedAt: AT,
      lastHeartbeatAt: AT,
    });
    const started = await store.insertStarted({
      walkerId,
      deviceId,
      responderIds: [responderId],
      startedAt: AT,
    });
    const startedId = started.inserted ? started.journeyId : '';

    expect(store.deviceOf(seeded)).toBe(deviceId);
    expect(store.lastHeartbeatAt(seeded)).toEqual(AT);
    expect(store.deviceOf(startedId)).toBe(deviceId);
    expect(store.lastHeartbeatAt(startedId)).toBeNull();
    expect(() => store.deviceOf(syntheticUuid())).toThrow(/no journey/);
    expect(() => store.lastHeartbeatAt(syntheticUuid())).toThrow(/no journey/);
  });

  test('setState moves a stored journey to another state, and keeps the one-unended rule', () => {
    const { store, walkerId, deviceId } = withWalker();
    const ended = store.seed({
      walkerId,
      deviceId,
      state: 'ENDED',
      responderIds: [],
      startedAt: AT,
    });
    const active = store.seed({
      walkerId,
      deviceId,
      state: 'ACTIVE',
      responderIds: [],
      startedAt: AT,
    });

    store.setState(active, 'LOST_CONTACT');
    expect(() => {
      store.setState(ended, 'ACTIVE');
    }).toThrow(/partial unique index/);
    store.setState(active, 'ENDED');

    expect(store.journeys().map((journey) => journey.state)).toEqual(['ENDED', 'ENDED']);
    expect(() => {
      store.setState(syntheticUuid(), 'ENDED');
    }).toThrow(/no journey/);
  });

  test('stores a heartbeat and its position in arrival order, numbered from 1, and hands back copies', async () => {
    const { store, walkerId, deviceId } = withWalker();
    const journeyId = store.seed({
      walkerId,
      deviceId,
      state: 'ACTIVE',
      responderIds: [],
      startedAt: AT,
    });
    const first = heartbeat(journeyId);
    const second = { ...heartbeat(journeyId), position: null };

    await store.recordHeartbeat(first);
    await store.recordHeartbeat(second);
    store.heartbeats()[0]?.receivedAt.setTime(0);
    store.positions()[0]?.recordedAt.setTime(0);
    first.receivedAt.setTime(0);

    expect(store.heartbeats()).toEqual([
      { id: 1, journeyId, eventId: first.eventId, receivedAt: AT, batteryLevel: 0.734375 },
      { id: 2, journeyId, eventId: second.eventId, receivedAt: AT, batteryLevel: 0.734375 },
    ]);
    expect(store.positions()).toEqual([{ heartbeatId: 1, ...first.position }]);
  });

  test('a heartbeat counts as stored only once it has settled, not when it is asked for', async () => {
    const { store, walkerId, deviceId } = withWalker();
    const journeyId = store.seed({
      walkerId,
      deviceId,
      state: 'ACTIVE',
      responderIds: [],
      startedAt: AT,
    });

    const storing = store.recordHeartbeat(heartbeat(journeyId));
    expect(store.heartbeats()).toEqual([]);

    await storing;
    expect(store.heartbeats()).toHaveLength(1);
  });

  test('a journey ID that is not a UUID is refused, as a uuid parameter is', async () => {
    const store = fakeJourneyStore();

    await expect(store.journeyForHeartbeat('journey-1')).rejects.toThrow(/uuid/);
    await expect(store.latestHeartbeatOf('journey-1')).rejects.toThrow(/uuid/);
    await expect(store.recordHeartbeat(heartbeat('journey-1'))).rejects.toThrow(/uuid/);
  });

  test('records the heartbeat port methods it is called with, and fails them all, or only the one named', async () => {
    const { store, walkerId, deviceId } = withWalker();
    const journeyId = store.seed({
      walkerId,
      deviceId,
      state: 'ACTIVE',
      responderIds: [],
      startedAt: AT,
    });
    const error = new Error('the database did not answer');

    store.failWith(error);
    await expect(store.journeyForHeartbeat(journeyId)).rejects.toBe(error);
    await expect(store.recordHeartbeat(heartbeat(journeyId))).rejects.toBe(error);
    await expect(store.latestHeartbeatOf(journeyId)).rejects.toBe(error);

    store.failWith(error, 'recordHeartbeat');
    await expect(store.journeyForHeartbeat(journeyId)).resolves.not.toBeNull();
    await expect(store.recordHeartbeat(heartbeat(journeyId))).rejects.toBe(error);
    await expect(store.latestHeartbeatOf(journeyId)).resolves.toBeNull();

    store.recover();
    await expect(store.recordHeartbeat(heartbeat(journeyId))).resolves.toEqual({
      outcome: 'recorded',
    });
    expect(store.heartbeats()).toHaveLength(1);
    expect(store.calls).toEqual([
      'journeyForHeartbeat',
      'recordHeartbeat',
      'latestHeartbeatOf',
      'journeyForHeartbeat',
      'recordHeartbeat',
      'latestHeartbeatOf',
      'recordHeartbeat',
    ]);
  });

  test('beforeNext runs its action once, as the named port method is called and before it answers', async () => {
    const { store, walkerId, deviceId } = withWalker();
    const journeyId = store.seed({
      walkerId,
      deviceId,
      state: 'ACTIVE',
      responderIds: [],
      startedAt: AT,
    });
    let ran = 0;
    store.beforeNext('recordHeartbeat', () => {
      ran += 1;
      store.setState(journeyId, 'ENDED');
    });

    await expect(store.journeyForHeartbeat(journeyId)).resolves.toMatchObject({ state: 'ACTIVE' });
    expect(ran).toBe(0);
    await expect(store.recordHeartbeat(heartbeat(journeyId))).resolves.toEqual({
      outcome: 'ended',
    });
    expect(ran).toBe(1);
    await expect(store.recordHeartbeat(heartbeat(journeyId))).resolves.toEqual({
      outcome: 'ended',
    });
    expect(ran).toBe(1);
    expect(store.heartbeats()).toEqual([]);
  });

  // RG-03: the test "its event ID rule is the contract’s" was deleted here
  // after LOST-01's code review. It held the fake's written-out copy of the
  // event ID rule to the contract's constants. The fake now imports
  // EVENT_ID_PATTERN and MAX_EVENT_ID_LENGTH from the contract, so there is
  // no copy left to hold. What it also checked stays checked: the shared
  // behaviour suite's two AC18 behaviours refuse an empty ID, 65 characters,
  // `_`, `.`, a space and a non-ASCII letter, and accept 64 characters and a
  // lone `-`, against this fake and against PostgreSQL; the contract's own
  // tests pin the pattern and the length.

  test('the test kit hands out the heartbeat builders beside the fake', () => {
    expect(kit.syntheticEventId).toBe(syntheticEventId);
    expect(kit.syntheticPosition).toBe(syntheticPosition);
    expect(kit.toStoredPosition).toBe(toStoredPosition);
  });
});

// ---------------------------------------------------------------------------
// LOST-02: the watchdog's and the outbox's methods, beyond the shared suite.
//
// The system tests prove the lost-contact alert by what this fake opened,
// wrote and handed out. A fake that guessed the time, opened a held journey,
// waited where the database skips, or could not fail would make those tests
// pass whatever the watchdog and the sender did.
// ---------------------------------------------------------------------------

const FIVE_MINUTES = 300_000;

/** A store with a clock, and one ACTIVE journey of a walker with `responders` responders. */
function watchedStore({
  responders = 2,
  silentForMs = FIVE_MINUTES,
}: { responders?: number; silentForMs?: number } = {}) {
  const clock = fakeClock(CLOCK_AT);
  const store = fakeJourneyStore({ clock });
  const walkerId = store.addUser();
  const deviceId = store.addDevice(walkerId);
  const responderIds = Array.from({ length: responders }, () => store.addUser());
  const journeyId = store.seed({
    walkerId,
    deviceId,
    state: 'ACTIVE',
    responderIds,
    startedAt: new Date(CLOCK_AT.getTime() - 2 * FIVE_MINUTES),
    lastHeartbeatAt: new Date(CLOCK_AT.getTime() - silentForMs),
  });
  return { clock, store, walkerId, deviceId, responderIds, journeyId };
}

/**
 * Lets pending promise callbacks run: a few turns of the microtask queue,
 * more than any answer of the fake takes. The test kit has no Node types, so
 * setImmediate is not to hand.
 */
async function settled(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) {
    await Promise.resolve();
  }
}

describe('fakeJourneyStore: the watchdog and the outbox (LOST-02)', () => {
  test('a store given no clock refuses every question about silence or delivery, loudly, naming the clock, and changes nothing', async () => {
    const store = fakeJourneyStore();
    const walkerId = store.addUser();
    const journeyId = store.seed({
      walkerId,
      deviceId: store.addDevice(walkerId),
      state: 'ACTIVE',
      responderIds: [store.addUser()],
      startedAt: AT,
    });

    for (const [what, asked] of [
      ['overdueJourneys', () => store.overdueJourneys(FIVE_MINUTES)],
      ['openLostContactAlert', () => store.openLostContactAlert({ journeyId, afterMs: 0 })],
      ['claimDue', () => store.claimDue({ limit: 50, leaseMs: 30_000 })],
      ['markSent', () => store.markSent(syntheticUuid())],
      [
        'markFailed',
        () =>
          store.markFailed({ messageId: syntheticUuid(), reason: 'NO_TARGET', retryAfterMs: 0 }),
      ],
    ] as const) {
      await expect(asked(), what).rejects.toThrow(/clock/);
    }
    expect(store.journeys()[0]?.state).toBe('ACTIVE');
    expect(store.alerts()).toEqual([]);
    expect(store.outbox()).toEqual([]);
  });

  test('its now is the clock’s, read as each call answers: the overdue read and the claim hand it back, and the open stamps it', async () => {
    const { clock, store, journeyId } = watchedStore();

    expect((await store.overdueJourneys(FIVE_MINUTES)).now).toEqual(CLOCK_AT);
    clock.advance(1_234);
    const opened = await store.openLostContactAlert({ journeyId, afterMs: FIVE_MINUTES });
    clock.advance(1_000);
    const claim = await store.claimDue({ limit: 50, leaseMs: 30_000 });

    expect(opened.outcome).toBe('opened');
    expect(store.alerts()[0]?.openedAt).toEqual(new Date(CLOCK_AT.getTime() + 1_234));
    expect(claim.now).toEqual(new Date(CLOCK_AT.getTime() + 2_234));
    expect(store.outbox().map(({ createdAt }) => createdAt)).toEqual([
      new Date(CLOCK_AT.getTime() + 1_234),
      new Date(CLOCK_AT.getTime() + 1_234),
    ]);
  });

  test('a clock that cannot be read fails the call, as a database that is gone does, and nothing changes', async () => {
    const { clock, store, journeyId } = watchedStore();
    const gone = new Error('Connection terminated unexpectedly');
    clock.failWith(gone);

    await expect(store.overdueJourneys(FIVE_MINUTES)).rejects.toBe(gone);
    await expect(store.openLostContactAlert({ journeyId, afterMs: FIVE_MINUTES })).rejects.toBe(
      gone,
    );
    expect(store.journeys()[0]?.state).toBe('ACTIVE');
    expect(store.alerts()).toEqual([]);
  });

  test('a held journey is read as overdue, its open is skipped, and a heartbeat for it waits until it is released, then is recorded', async () => {
    const { store, journeyId } = watchedStore();
    store.hold(journeyId);

    expect((await store.overdueJourneys(FIVE_MINUTES)).journeys.map(({ id }) => id)).toEqual([
      journeyId,
    ]);
    expect(await store.openLostContactAlert({ journeyId, afterMs: FIVE_MINUTES })).toEqual({
      outcome: 'skipped',
    });
    let answered: unknown = null;
    const waiting = store
      .recordHeartbeat(heartbeat(journeyId, new Date(CLOCK_AT.getTime())))
      .then((result) => (answered = result));
    await settled();
    expect(answered).toBeNull();
    expect(store.heartbeats()).toEqual([]);

    store.release(journeyId);
    await waiting;

    expect(answered).toEqual({ outcome: 'recorded' });
    expect(store.lastHeartbeatAt(journeyId)).toEqual(CLOCK_AT);
    // Contact came, so the journey is no longer overdue: nothing to open.
    expect(await store.openLostContactAlert({ journeyId, afterMs: FIVE_MINUTES })).toEqual({
      outcome: 'skipped',
    });
  });

  test('an open told to wait for a row held by hold answers held and writes nothing; without a wait it is skipped; each open is recorded with its wait, or none', async () => {
    const { store, journeyId } = watchedStore();
    store.hold(journeyId);

    expect(await store.openLostContactAlert({ journeyId, afterMs: FIVE_MINUTES })).toEqual({
      outcome: 'skipped',
    });
    expect(
      await store.openLostContactAlert({ journeyId, afterMs: FIVE_MINUTES, lockWaitMs: 5_000 }),
    ).toEqual({ outcome: 'held' });
    expect(store.journeys()[0]?.state).toBe('ACTIVE');
    expect(store.alerts()).toEqual([]);
    expect(store.outbox()).toEqual([]);
    expect(store.openRequests()).toEqual([
      { journeyId, afterMs: FIVE_MINUTES },
      { journeyId, afterMs: FIVE_MINUTES, lockWaitMs: 5_000 },
    ]);
    await expect(
      store.openLostContactAlert({ journeyId, afterMs: FIVE_MINUTES, lockWaitMs: Number.NaN }),
    ).rejects.toThrow(/lockWaitMs/);
  });

  test('a row held until waited for is skipped by an open without a wait; an open with one lets the holder act and let go, then checks the journey as the holder left it', async () => {
    const unchanged = watchedStore();
    unchanged.store.holdUntilWaited(unchanged.journeyId);

    expect(
      await unchanged.store.openLostContactAlert({
        journeyId: unchanged.journeyId,
        afterMs: FIVE_MINUTES,
      }),
    ).toEqual({ outcome: 'skipped' });
    expect(
      (
        await unchanged.store.openLostContactAlert({
          journeyId: unchanged.journeyId,
          afterMs: FIVE_MINUTES,
          lockWaitMs: 5_000,
        })
      ).outcome,
    ).toBe('opened');
    expect(unchanged.store.alerts()).toHaveLength(1);

    // A concurrent sweeper as the holder: it opens the alert itself, then lets go.
    const raced = watchedStore();
    const order: string[] = [];
    raced.store.holdUntilWaited(raced.journeyId, async () => {
      order.push('holder acts');
      const theirs = await raced.store.openLostContactAlert({
        journeyId: raced.journeyId,
        afterMs: FIVE_MINUTES,
      });
      order.push(theirs.outcome);
    });

    const mine = await raced.store.openLostContactAlert({
      journeyId: raced.journeyId,
      afterMs: FIVE_MINUTES,
      lockWaitMs: 5_000,
    });

    expect(order).toEqual(['holder acts', 'opened']);
    expect(mine).toEqual({ outcome: 'skipped' });
    expect(raced.store.journeys()[0]?.state).toBe('LOST_CONTACT');
    expect(raced.store.alerts()).toHaveLength(1);
    // Let go for good: a later waiting open finds nothing held.
    expect(
      await raced.store.openLostContactAlert({
        journeyId: raced.journeyId,
        afterMs: FIVE_MINUTES,
        lockWaitMs: 5_000,
      }),
    ).toEqual({ outcome: 'skipped' });
  });

  test('a heartbeat for a row held until waited for waits, as for any held row, and goes on when the hold ends', async () => {
    const { store, journeyId } = watchedStore();
    store.holdUntilWaited(journeyId);
    let answered: unknown = null;
    const waiting = store
      .recordHeartbeat(heartbeat(journeyId, new Date(CLOCK_AT.getTime())))
      .then((result) => (answered = result));
    await settled();
    expect(answered).toBeNull();

    store.release(journeyId);
    await waiting;

    expect(answered).toEqual({ outcome: 'recorded' });
  });

  test('hold and release refuse a journey never stored, as the other test helpers do', () => {
    const store = fakeJourneyStore({ clock: fakeClock(CLOCK_AT) });

    expect(() => {
      store.hold(syntheticUuid());
    }).toThrow(/no journey/);
    expect(() => {
      store.release(syntheticUuid());
    }).toThrow(/no journey/);
    expect(() => {
      store.holdUntilWaited(syntheticUuid());
    }).toThrow(/no journey/);
  });

  test('records the new port methods it is called with, fails them all or only the one named, and changes nothing while failing', async () => {
    const { store, journeyId } = watchedStore();
    const error = new Error('the database went away');
    store.failWith(error, 'openLostContactAlert');

    expect((await store.overdueJourneys(FIVE_MINUTES)).journeys).toHaveLength(1);
    await expect(store.openLostContactAlert({ journeyId, afterMs: FIVE_MINUTES })).rejects.toBe(
      error,
    );
    expect(store.journeys()[0]?.state).toBe('ACTIVE');
    expect(store.alerts()).toEqual([]);

    store.failWith(error);
    await expect(store.claimDue({ limit: 50, leaseMs: 30_000 })).rejects.toBe(error);
    await expect(store.markSent(syntheticUuid())).rejects.toBe(error);
    await expect(
      store.markFailed({ messageId: syntheticUuid(), reason: 'REFUSED', retryAfterMs: 0 }),
    ).rejects.toBe(error);

    store.recover();
    expect((await store.openLostContactAlert({ journeyId, afterMs: FIVE_MINUTES })).outcome).toBe(
      'opened',
    );
    expect(store.calls).toEqual([
      'overdueJourneys',
      'openLostContactAlert',
      'claimDue',
      'markSent',
      'markFailed',
      'openLostContactAlert',
    ]);
  });

  test('LOST-02-AC9: beforeNext stores a heartbeat as the open is asked for, before it answers, and the open then skips: contact that arrives during the sweep wins', async () => {
    const { clock, store, journeyId } = watchedStore();
    const read = await store.overdueJourneys(FIVE_MINUTES);
    expect(read.journeys.map(({ id }) => id)).toEqual([journeyId]);

    store.beforeNext('openLostContactAlert', () => {
      void store.recordHeartbeat(heartbeat(journeyId, new Date(CLOCK_AT.getTime())));
    });
    clock.advance(1);

    expect(await store.openLostContactAlert({ journeyId, afterMs: FIVE_MINUTES })).toEqual({
      outcome: 'skipped',
    });
    expect(store.journeys()[0]?.state).toBe('ACTIVE');
    expect(store.alerts()).toEqual([]);
    expect(store.outbox()).toEqual([]);
  });

  test('markSent and markFailed refuse a message never written, and a claim refuses a negative limit', async () => {
    const { store } = watchedStore();

    await expect(store.markSent(syntheticUuid())).rejects.toThrow(/no message/);
    await expect(
      store.markFailed({ messageId: syntheticUuid(), reason: 'NO_TARGET', retryAfterMs: 0 }),
    ).rejects.toThrow(/no message/);
    await expect(store.claimDue({ limit: -1, leaseMs: 30_000 })).rejects.toThrow();
  });

  test('a message counts as sent only once markSent has settled, and keeps the first time it was marked', async () => {
    const { clock, store, journeyId } = watchedStore({ responders: 1 });
    const opened = await store.openLostContactAlert({ journeyId, afterMs: FIVE_MINUTES });
    if (opened.outcome !== 'opened') {
      throw new Error('expected the journey to be opened');
    }
    const [message] = opened.messages;
    if (message === undefined) {
      throw new Error('expected one message');
    }

    const marking = store.markSent(message.messageId);
    expect(store.outbox()[0]?.sentAt).toBeNull();
    await marking;
    expect(store.outbox()[0]?.sentAt).toEqual(CLOCK_AT);

    clock.advance(5_000);
    await store.markSent(message.messageId);
    expect(store.outbox()[0]?.sentAt).toEqual(CLOCK_AT);
  });

  test('what alerts() and outbox() hand back cannot change what it holds', async () => {
    const { store, journeyId } = watchedStore({ responders: 1 });
    await store.openLostContactAlert({ journeyId, afterMs: FIVE_MINUTES });

    const [alert] = store.alerts();
    const [message] = store.outbox();
    if (alert === undefined || message === undefined) {
      throw new Error('expected one alert and one message');
    }
    alert.state = 'RESOLVED';
    alert.openedAt.setTime(0);
    message.sentAt = new Date(0);
    message.nextAttemptAt.setTime(0);

    expect(store.alerts()[0]?.state).toBe('OPEN');
    expect(store.alerts()[0]?.openedAt).toEqual(CLOCK_AT);
    expect(store.outbox()[0]?.sentAt).toBeNull();
    expect(store.outbox()[0]?.nextAttemptAt).toEqual(CLOCK_AT);
  });

  test('a journey given a responder twice cannot be opened: one message per (alert, recipient, kind), as the unique index holds, and nothing is written', async () => {
    const clock = fakeClock(CLOCK_AT);
    const store = fakeJourneyStore({ clock });
    const walkerId = store.addUser();
    const responderId = store.addUser();
    const journeyId = store.seed({
      walkerId,
      deviceId: store.addDevice(walkerId),
      state: 'ACTIVE',
      responderIds: [responderId, responderId],
      startedAt: new Date(CLOCK_AT.getTime() - 2 * FIVE_MINUTES),
    });

    await expect(store.openLostContactAlert({ journeyId, afterMs: FIVE_MINUTES })).rejects.toThrow(
      /unique/,
    );
    expect(store.journeys()[0]?.state).toBe('ACTIVE');
    expect(store.alerts()).toEqual([]);
    expect(store.outbox()).toEqual([]);
  });
});
