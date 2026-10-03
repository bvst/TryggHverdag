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

function underTest(): JourneyStoreUnderTest {
  const store = fakeJourneyStore();
  const knownJourney = (journeyId: string) =>
    store.journeys().some((journey) => journey.id === journeyId.toLowerCase());
  const heartbeatsOf = (journeyId: string) =>
    store.heartbeats().filter((heartbeat) => heartbeat.journeyId === journeyId.toLowerCase());
  return {
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
