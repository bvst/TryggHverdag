// req-coverage: fixtures-only — this tests the test kit, not a requirement.
//
// The journey system tests prove the start rules by what this fake stores and
// refuses. A fake that let a walker hold two unended journeys, stored half a
// start, or could not fail would not go red: it would make those tests pass
// whatever the server did. The shared behaviour suite below is the same one
// the real adapter runs against PostgreSQL, so the two cannot drift apart.
import { describe, expect, test } from 'vitest';
import { fakeJourneyStore } from './fake-journey-store.ts';
import * as kit from './index.ts';
import {
  JOURNEY_STORE_BEHAVIOUR,
  RACE_ROUNDS,
  RACERS,
  type JourneyStoreUnderTest,
} from './journey-store-behaviour.ts';
import { syntheticUuid } from './synthetic-ids.ts';

const AT = new Date('2026-10-01T21:00:00.000Z');

function underTest(): JourneyStoreUnderTest {
  const store = fakeJourneyStore();
  return {
    store,
    addUser: () => Promise.resolve(store.addUser()),
    seedJourney: (journey) => Promise.resolve(store.seed(journey)),
    journeysOf: (walkerId) =>
      Promise.resolve(store.journeys().filter((journey) => journey.walkerId === walkerId)),
  };
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
    ]);
    expect(RACERS).toBeGreaterThanOrEqual(10);
    expect(RACE_ROUNDS).toBeGreaterThanOrEqual(5);
  });

  test.each(JOURNEY_STORE_BEHAVIOUR)('$name', async ({ run }) => {
    await run(underTest());
  });
});

describe('fakeJourneyStore, beyond the shared suite', () => {
  test('seeds a journey in any state, and hands back what it stored', () => {
    const store = fakeJourneyStore();
    const walkerId = store.addUser();
    const responderId = store.addUser();

    const ended = store.seed({
      walkerId,
      state: 'ENDED',
      responderIds: [responderId],
      startedAt: AT,
    });
    const lost = store.seed({
      walkerId,
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
    const store = fakeJourneyStore();
    const walkerId = store.addUser();
    const id = syntheticUuid();

    expect(store.seed({ walkerId, state: 'ENDED', responderIds: [], startedAt: AT, id })).toBe(id);
    expect(() =>
      store.seed({ walkerId, state: 'ENDED', responderIds: [], startedAt: AT, id }),
    ).toThrow(/already stored/);
  });

  test('refuses to seed a second unended journey, as the partial unique index would', () => {
    const store = fakeJourneyStore();
    const walkerId = store.addUser();
    store.seed({ walkerId, state: 'ACTIVE', responderIds: [], startedAt: AT });

    expect(() =>
      store.seed({ walkerId, state: 'LOST_CONTACT', responderIds: [], startedAt: AT }),
    ).toThrow(/partial unique index/);
    expect(store.journeys()).toHaveLength(1);
  });

  test('refuses to seed for a walker or a responder who is not a user, as the foreign keys would', () => {
    const store = fakeJourneyStore();
    const walkerId = store.addUser();

    expect(() =>
      store.seed({ walkerId: syntheticUuid(), state: 'ENDED', responderIds: [], startedAt: AT }),
    ).toThrow(/foreign key/);
    expect(() =>
      store.seed({ walkerId, state: 'ENDED', responderIds: [syntheticUuid()], startedAt: AT }),
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
    const store = fakeJourneyStore();
    const walkerId = store.addUser();
    const responderId = store.addUser();
    store.seed({ walkerId, state: 'ENDED', responderIds: [], startedAt: AT });
    store.journeys();
    expect(store.calls).toEqual([]);

    await store.unendedJourneyOf(walkerId);
    await store.existingUsers([walkerId]);
    await store.insertStarted({ walkerId, responderIds: [responderId], startedAt: AT });

    expect(store.calls).toEqual(['unendedJourneyOf', 'existingUsers', 'insertStarted']);
  });

  test('while failing, every port method rejects with exactly the error given, and changes nothing', async () => {
    const store = fakeJourneyStore();
    const walkerId = store.addUser();
    const error = new Error('the database did not answer');
    store.failWith(error);

    await expect(store.unendedJourneyOf(walkerId)).rejects.toBe(error);
    await expect(store.existingUsers([walkerId])).rejects.toBe(error);
    await expect(store.insertStarted({ walkerId, responderIds: [], startedAt: AT })).rejects.toBe(
      error,
    );

    expect(store.journeys()).toEqual([]);
    expect(store.calls).toEqual(['unendedJourneyOf', 'existingUsers', 'insertStarted']);
  });

  test('answers again after recovering', async () => {
    const store = fakeJourneyStore();
    const walkerId = store.addUser();
    const responderId = store.addUser();
    store.failWith(new Error('the database did not answer'));

    store.recover();

    const result = await store.insertStarted({
      walkerId,
      responderIds: [responderId],
      startedAt: AT,
    });
    expect(result.inserted).toBe(true);
  });

  test('a start counts as stored only once it has settled, not when it is asked for', async () => {
    const store = fakeJourneyStore();
    const walkerId = store.addUser();
    const responderId = store.addUser();

    const storing = store.insertStarted({ walkerId, responderIds: [responderId], startedAt: AT });
    expect(store.journeys()).toEqual([]);

    await storing;
    expect(store.journeys()).toHaveLength(1);
  });

  test('stores the responders it is given, repeats included, so a caller that forgot to drop them shows', async () => {
    const store = fakeJourneyStore();
    const walkerId = store.addUser();
    const responderId = store.addUser();

    await store.insertStarted({
      walkerId,
      responderIds: [responderId, responderId],
      startedAt: AT,
    });

    expect(store.journeys()[0]?.responderIds).toEqual([responderId, responderId]);
  });

  test('what it hands back cannot change what it holds', async () => {
    const store = fakeJourneyStore();
    const walkerId = store.addUser();
    const responderId = store.addUser();
    const startedAt = new Date(AT.getTime());
    const responderIds = [responderId];
    await store.insertStarted({ walkerId, responderIds, startedAt });

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
    const journeyId = syntheticUuid();
    store.seed({
      walkerId: given.toUpperCase(),
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
