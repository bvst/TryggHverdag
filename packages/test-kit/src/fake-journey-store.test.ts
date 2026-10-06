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
    letTimePass: (ms) => {
      clock.advance(ms);
      return Promise.resolve();
    },
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
    // LOST-03: an alert's resolution, a message's withdrawal and a journey's
    // end, each through a reader of its own, so the readers above keep their
    // shapes.
    resolutionsOf: (journeyId) =>
      Promise.resolve(
        alertsOf(journeyId).map(({ id, resolvedAt, resolution }) => ({
          alertId: id,
          resolvedAt,
          resolution,
        })),
      ),
    withdrawalsOf: (journeyId) => {
      const alertIds = alertsOf(journeyId).map(({ id }) => id);
      return Promise.resolve(
        store
          .outbox()
          .filter(({ alertId }) => alertIds.includes(alertId))
          .map(({ messageId, createdAt, withdrawnAt }) => ({ messageId, createdAt, withdrawnAt })),
      );
    },
    endOf: (journeyId) => Promise.resolve(knownJourney(journeyId) ? store.endOf(journeyId) : null),
    // A refusal is a rejection, as the database's is, not a throw.
    seedAlert: (alert) =>
      new Promise<string>((resolve) => {
        resolve(store.seedAlert(alert));
      }),
    seedMessage: (message) =>
      new Promise<string>((resolve) => {
        resolve(store.seedMessage(message));
      }),
    removeResponders: (journeyId) => {
      store.removeResponders(journeyId);
      return Promise.resolve();
    },
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
      // RG-03 (LOST-03): renamed with its behaviour, which now holds a
      // heartbeat received five minutes or more before the store's now; a
      // fresher one brings the journey back (LOST-03-AC2). Its assertions
      // are unchanged.
      'LOST-01-AC8: a heartbeat for a journey in LOST_CONTACT is recorded and advances last contact; received five minutes or more before the store’s now, it brings nothing back, and the journey stays LOST_CONTACT (LOST-03-AC2)',
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
      // RG-03 (LOST-03): renamed with its behaviour. LOST-03-AC5's property
      // replaces its last clause, "a heartbeat after that does not move it
      // back"; the rest of it stands, and every step is now checked.
      'LOST-02-AC2 and LOST-03-AC5: for any sequence of heartbeats, fresh or stale, received in any order, and sweeps between them, after every step the store agrees with the rules applied step by step: a sweep moves the journey to LOST_CONTACT exactly when it has been silent five minutes or more, and a heartbeat that leaves its silence under five minutes moves it back; exactly one unresolved alert while it is LOST_CONTACT and none while it is ACTIVE; one stand-down per responder for each resolved alert, and none for an unresolved one',
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
      // RG-03 (LOST-02, review loop 1): a held row that no longer matches
      // (approach item 3, step 4; spec item 8a). Every other name is
      // unchanged; this one is added.
      // RG-03 (LOST-02, review loop 2): a lock wait PostgreSQL would read as no
      // limit is refused (approach item 3; spec item 15a). Every other name is
      // unchanged; this one is added. Renamed in loop 2's last round, adding
      // 1.5 to the values (test-auditor): with 0.5 alone, a store that checked
      // only the range, and not that it is a whole number, still passed.
      'LOST-02-AC20: an open given a lockWaitMs that is not a whole number from 1 to 2147483647 (0, -1, 0.5, 1.5, NaN, 2147483648) is refused, naming lockWaitMs, and writes nothing',
      'LOST-02-AC20: a held row that no longer matches answers skipped at once to an open with a lock wait, never held: one already LOST_CONTACT, and one whose last contact has moved',
      'LOST-02-AC7: 10 opens racing for one overdue journey, 5 times over: exactly one opens and every other skips, none an error; one alert, and one message per responder',
      'LOST-02-AC14: a claim hands out each due message once: one attempt counted, leased until the claim’s now plus the lease, and not handed out again while the lease runs',
      'LOST-02-AC14: a claim takes at most its limit, and the next claim takes the rest',
      'LOST-02-AC7: 10 claims racing: each due message is handed to exactly one of them',
      'LOST-02-AC15: a failed message keeps its reason and is due again after the delay given, with the same ID and one more attempt; a sent one is marked at the store’s now, and never handed out again',
      // RG-03 (LOST-02, review loop 1, test-auditor, D-100): moved here from
      // this file's own test of the fake, so the adapter is held to it at L3
      // as well. Every other name is unchanged; this one is added.
      'LOST-02-AC16: a message marked sent again, as one sent again after its lease passed is, keeps the time it was first marked',
      'LOST-02-AC15: a failure reason outside the push port’s four is refused, and the message is left as it was',
      'LOST-02-AC13: the heartbeat received at the alert’s silent_since is the journey’s latest, with its battery level and whether it had a position',
      // RG-03 (LOST-03): back in contact, resolving an alert and "I'm home"
      // join the shared suite, as the spec's test plan says (the store's side
      // of AC2, AC4 to AC8, AC12 and AC14 to AC16), so the fake and the
      // adapter are held to them alike (D-100). Two names above changed with
      // their behaviours; these are added.
      'LOST-03-AC2: a heartbeat that leaves a LOST_CONTACT journey’s silence under five minutes by the store’s now brings it back in one step: the heartbeat stored and last contact moved; the journey ACTIVE; its alert RESOLVED at that now, resolution BACK_IN_CONTACT; each unsent lost-contact message withdrawn at that now, keeping its attempts; and one BACK_IN_CONTACT message per responder, written and due at that now, with an ID of its own; the answer names the alert and those messages',
      'LOST-03-AC2: a heartbeat that leaves the silence at five minutes or more brings nothing back: it is stored and moves last contact, and the journey stays LOST_CONTACT with its alert OPEN and unresolved, no message withdrawn and none written; at the threshold itself against the fake, a margin past it against the database',
      'LOST-03-AC4: whatever state the journey’s unresolved alert is in — OPEN, ESCALATED or ACKNOWLEDGED — fresh contact resolves exactly that alert, its time and its resolution set together; an older RESOLVED alert of the journey, with its times and its messages, and another journey’s open alert, with its messages, are untouched',
      'LOST-03-AC4: a LOST_CONTACT journey with no unresolved alert — none at all, or only a RESOLVED one — still moves back to ACTIVE on fresh contact, writes no message and touches no alert, and the answer names no alert',
      // Joined after the red phase (the spec's "Tests added after the red
      // phase"): the pinned list grows with the suite, by design.
      'LOST-03-AC4: recordHome on a LOST_CONTACT journey with no unresolved alert ends it ENDED with end reason HOME, and answers home, from LOST_CONTACT, with no alert and no messages',
      'LOST-03-AC4: a LOST_CONTACT journey whose responder rows are gone still moves back on fresh contact and resolves its alert, withdrawing its unsent lost-contact messages, and writes no stand-down',
      'LOST-03-AC6: every responder is stood down once, whatever became of their lost-contact message — accepted, failed and due again, or never claimed; a second fresh heartbeat, a sweep and a claim add none, and one message per (alert, recipient, kind) holds a second stand-down out',
      'LOST-03-AC7: when contact comes back, a lost-contact message not yet accepted is withdrawn at the store’s now, keeping its attempts and its last failure, and a claim never hands it out again, whatever its due time and whatever a later mark says; one accepted is left as it was, sent and not withdrawn',
      'LOST-03-AC8: a responder’s stand-down waits for their lost-contact message when it was handed over and is not due yet — until its lease ends while it may be in the port’s hands, until its retry once it failed — and is due at the store’s now for one sent or never handed over; a claim hands out each stand-down only once it is due',
      // Joined in review loop 1 (the spec's items 9a and 1b).
      'LOST-03-AC8: a responder whose lost-contact message failed and whose retry time had already passed when contact came back is not held: their stand-down is due at the alert’s resolved_at',
      'LOST-03-AC8: an open withdraws the journey’s earlier alerts’ unsent stand-downs at the store’s now, and leaves alone those already sent, every other journey’s messages and its own new ones; an open that skips withdraws nothing',
      'LOST-03-AC12: a heartbeat a LOST_CONTACT journey already has, sent again later, is a duplicate and changes nothing; and 10 different fresh heartbeats at once, 5 times over, are each stored, exactly one bringing the journey back and every other recorded, with one resolution and one stand-down per responder; the one that brought it back, sent again, is a duplicate and writes nothing',
      'LOST-03-AC14: "I’m home" (recordHome) on a LOST_CONTACT journey ends it in one step: ENDED, end reason HOME at the store’s now; its alert RESOLVED at that now, resolution HOME; each unsent lost-contact message withdrawn, a stand-down held for one in the port’s hands; one HOME message per responder; the answer says it came from LOST_CONTACT and names the alert and the messages. Afterwards a heartbeat is answered ended and stores nothing, the overdue read never returns it, and the walker can start again (SM-04)',
      'LOST-03-AC15: "I’m home" (recordHome) on an ACTIVE journey ends it, end reason HOME at the store’s now, from ACTIVE, and touches no alert and writes no message — with no alert, and with only resolved ones; the overdue read and the open then never take it, and the walker can start again (SM-04)',
      // RG-03 (review loop 1, the spec's item 3): renamed with its answer,
      // already_ended, not ended.
      'LOST-03-AC16: "I’m home" (recordHome) on a journey already ENDED — by an earlier "I’m home", or set directly — is answered already_ended and changes nothing: its end, its alerts and its messages stay as they were; for a journey that does not exist the store rejects (SM-04, SM-07, SM-08)',
      // Joined in review loop 1 (the spec's item 2a).
      'LOST-03-AC16: recordHome decides by the home rule under the lock: a walker or a device that is not the journey’s makes it reject and write nothing; an ENDED journey answers already_ended and writes nothing; an ACTIVE one is ended without resolving anything; a LOST_CONTACT one is ended and its alert resolved with resolution HOME',
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

  test('a held row that no longer matches is skipped by both opens, waiting or not, and a holder that would let go is not asked to', async () => {
    // Already alerted, and held.
    const alerted = watchedStore({ silentForMs: 60 * FIVE_MINUTES });
    alerted.store.setState(alerted.journeyId, 'LOST_CONTACT');
    alerted.store.hold(alerted.journeyId);
    // Contact came, and held by a holder that would let go.
    const heard = watchedStore();
    expect(
      await heard.store.recordHeartbeat(heartbeat(heard.journeyId, new Date(CLOCK_AT.getTime()))),
    ).toEqual({ outcome: 'recorded' });
    const asked: string[] = [];
    heard.store.holdUntilWaited(heard.journeyId, () => {
      asked.push('let go');
    });

    for (const { store, journeyId } of [alerted, heard]) {
      for (const lockWaitMs of [undefined, 5_000]) {
        expect(
          await store.openLostContactAlert(
            lockWaitMs === undefined
              ? { journeyId, afterMs: FIVE_MINUTES }
              : { journeyId, afterMs: FIVE_MINUTES, lockWaitMs },
          ),
        ).toEqual({ outcome: 'skipped' });
      }
      expect(store.alerts()).toEqual([]);
    }
    expect(asked).toEqual([]);
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

  // RG-03 (LOST-02, review loop 1, test-auditor, D-100): this test also
  // held "and keeps the first time it was marked": a second markSent five
  // seconds later left the first time. That half moved to the shared suite,
  // as "LOST-02-AC16: a message marked sent again … keeps the time it was
  // first marked", which runs against this fake and against the adapter, with
  // the same assertion. What stays here is the fake's own turn-later answer.
  test('a message counts as sent only once markSent has settled', async () => {
    const { store, journeyId } = watchedStore({ responders: 1 });
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

// ---------------------------------------------------------------------------
// LOST-03: back in contact and "I'm home", beyond the shared suite.
//
// The contact system tests prove back in contact and "I'm home" by what this
// fake resolved, withdrew, wrote and ended. A fake that guessed the time,
// stood down without its alert, handed out a withdrawn message, wrote half a
// resolution, could not hold a row for its holder's own work, or could not
// fail would make those tests pass whatever the journey module did.
// ---------------------------------------------------------------------------

/** A store with a clock, and one LOST_CONTACT journey with its open alert and a message per responder. */
async function lostStore(responders = 2) {
  const watched = watchedStore({ responders, silentForMs: FIVE_MINUTES });
  const opened = await watched.store.openLostContactAlert({
    journeyId: watched.journeyId,
    afterMs: FIVE_MINUTES,
  });
  if (opened.outcome !== 'opened') {
    throw new Error(`expected the journey to be opened, but it was ${opened.outcome}`);
  }
  return { ...watched, alertId: opened.alertId };
}

/**
 * "I'm home" for this journey as the store takes it since review loop 1:
 * from the journey's own walker and the device that started it, as read.
 */
async function homeFor(
  store: ReturnType<typeof fakeJourneyStore>,
  journeyId: string,
): Promise<{ journeyId: string; walkerId: string; deviceId: string }> {
  const journey = await store.journeyForHeartbeat(journeyId);
  if (journey === null) {
    throw new Error(`no journey ${journeyId} to say "I’m home" for`);
  }
  return { journeyId, walkerId: journey.walkerId, deviceId: journey.deviceId };
}

describe('fakeJourneyStore: back in contact and "I’m home" (LOST-03)', () => {
  test('a store given no clock refuses, loudly and naming the clock, to say whether contact is back or to end a journey, and changes nothing; a heartbeat it needs no time for is answered without one', async () => {
    const store = fakeJourneyStore();
    const walkerId = store.addUser();
    const deviceId = store.addDevice(walkerId);
    const lost = store.seed({
      walkerId,
      deviceId,
      state: 'LOST_CONTACT',
      responderIds: [store.addUser()],
      startedAt: AT,
    });
    const otherWalker = store.addUser();
    const active = store.seed({
      walkerId: otherWalker,
      deviceId: store.addDevice(otherWalker),
      state: 'ACTIVE',
      responderIds: [store.addUser()],
      startedAt: AT,
    });

    // Review loop 1: recordHome takes the walker and the device too.
    await expect(store.recordHeartbeat(heartbeat(lost))).rejects.toThrow(/clock/);
    await expect(store.recordHome({ journeyId: lost, walkerId, deviceId })).rejects.toThrow(
      /clock/,
    );
    const activeHome = await homeFor(store, active);
    await expect(store.recordHome(activeHome)).rejects.toThrow(/clock/);
    expect(store.heartbeats()).toEqual([]);
    expect(store.journeys().map(({ state }) => state)).toEqual(['LOST_CONTACT', 'ACTIVE']);
    expect(store.endOf(lost)).toEqual({ endedAt: null, endReason: null });

    // An ACTIVE journey's heartbeat asks nothing about contact.
    expect(await store.recordHeartbeat(heartbeat(active))).toEqual({ outcome: 'recorded' });
    // An ended journey is answered already_ended, before any time is needed.
    // RG-03 (review loop 1, the spec's item 3): this expected { outcome:
    // 'ended' }; the store's answer is now already_ended. The heartbeat's
    // answer below keeps `ended`.
    store.setState(lost, 'ENDED');
    expect(await store.recordHome({ journeyId: lost, walkerId, deviceId })).toEqual({
      outcome: 'already_ended',
    });
    expect(await store.recordHeartbeat(heartbeat(lost))).toEqual({ outcome: 'ended' });
  });

  test('a heartbeat that fails a check is refused before the store asks about contact, and leaves the alert open', async () => {
    const { store, journeyId, alertId } = await lostStore();

    await expect(
      store.recordHeartbeat({ ...heartbeat(journeyId, CLOCK_AT), batteryLevel: 1.5 }),
    ).rejects.toThrow(/battery_level/);

    expect(store.journeys()[0]?.state).toBe('LOST_CONTACT');
    expect(store.alerts().find(({ id }) => id === alertId)?.state).toBe('OPEN');
    expect(store.outbox().every(({ withdrawnAt }) => withdrawnAt === null)).toBe(true);
  });

  test('contact is decided on the clock’s reading as the heartbeat is written: moved on by beforeNext past five minutes from the receive time, it brings nothing back; under it, it does', async () => {
    const stale = await lostStore();
    stale.store.beforeNext('recordHeartbeat', () => {
      stale.clock.advance(FIVE_MINUTES);
    });

    expect(await stale.store.recordHeartbeat(heartbeat(stale.journeyId, CLOCK_AT))).toEqual({
      outcome: 'recorded',
    });
    expect(stale.store.journeys()[0]?.state).toBe('LOST_CONTACT');

    const fresh = await lostStore();
    fresh.store.beforeNext('recordHeartbeat', () => {
      fresh.clock.advance(FIVE_MINUTES - 1);
    });

    expect((await fresh.store.recordHeartbeat(heartbeat(fresh.journeyId, CLOCK_AT))).outcome).toBe(
      'back_in_contact',
    );
    expect(fresh.store.alerts()[0]?.resolvedAt).toEqual(
      new Date(CLOCK_AT.getTime() + FIVE_MINUTES - 1),
    );
  });

  test('a stand-down that cannot be written, a second of its kind for the same alert and recipient, leaves nothing of the step: no heartbeat, the journey LOST_CONTACT, its alert open, nothing withdrawn', async () => {
    const { store, journeyId, alertId, responderIds } = await lostStore();
    for (const kind of ['BACK_IN_CONTACT', 'HOME'] as const) {
      store.seedMessage({
        alertId,
        recipientId: responderIds[1] ?? '',
        kind,
        createdAt: CLOCK_AT,
        nextAttemptAt: CLOCK_AT,
      });
    }
    const outbox = store.outbox();

    await expect(store.recordHeartbeat(heartbeat(journeyId, CLOCK_AT))).rejects.toThrow(/unique/);
    await expect(store.recordHome(await homeFor(store, journeyId))).rejects.toThrow(/unique/);

    expect(store.heartbeats()).toEqual([]);
    expect(store.journeys()[0]?.state).toBe('LOST_CONTACT');
    expect(store.endOf(journeyId)).toEqual({ endedAt: null, endReason: null });
    expect(store.alerts()[0]).toMatchObject({ state: 'OPEN', resolvedAt: null, resolution: null });
    expect(store.outbox()).toEqual(outbox);
  });

  test('recordHome is a port method: recorded among the calls, failed when told to, alone or with every other, changing nothing, and its beforeNext action runs as it is called', async () => {
    const { clock, store, journeyId } = await lostStore();
    const error = new Error('the database went away');
    store.failWith(error, 'recordHome');

    await expect(store.recordHome(await homeFor(store, journeyId))).rejects.toBe(error);
    expect(store.journeys()[0]?.state).toBe('LOST_CONTACT');

    store.recover();
    store.beforeNext('recordHome', () => {
      clock.advance(1_000);
    });
    expect((await store.recordHome(await homeFor(store, journeyId))).outcome).toBe('home');
    expect(store.endOf(journeyId)).toEqual({
      endedAt: new Date(CLOCK_AT.getTime() + 1_000),
      endReason: 'HOME',
    });
    expect(store.calls.filter((call) => call === 'recordHome')).toHaveLength(2);
  });

  test('a heartbeat and an "I’m home" for a held row wait for it; commitHold lets the holder work on the row first, and what waited goes on only once that work is done', async () => {
    const { store, journeyId } = watchedStore({ silentForMs: FIVE_MINUTES });
    store.hold(journeyId);
    const order: string[] = [];
    const heartbeatAnswer = store
      .recordHeartbeat(heartbeat(journeyId, CLOCK_AT))
      .then((answer) => order.push(`heartbeat ${answer.outcome}`));
    await settled();
    expect(order).toEqual([]);

    await store.commitHold(journeyId, async () => {
      const opened = await store.openLostContactAlert({ journeyId, afterMs: FIVE_MINUTES });
      order.push(`holder ${opened.outcome}`);
    });
    await heartbeatAnswer;

    expect(order).toEqual(['holder opened', 'heartbeat back_in_contact']);
    expect(store.journeys()[0]?.state).toBe('ACTIVE');

    store.hold(journeyId);
    let home: unknown = null;
    const homeAnswer = store
      .recordHome(await homeFor(store, journeyId))
      .then((answer) => (home = answer));
    await settled();
    expect(home).toBeNull();
    store.release(journeyId);
    await homeAnswer;
    expect(home).toMatchObject({ outcome: 'home', from: 'ACTIVE' });
    await expect(store.commitHold(syntheticUuid(), () => Promise.resolve())).rejects.toThrow(
      /no journey/,
    );
  });

  test('seedAlert and seedMessage keep the database’s rules: one unresolved alert per journey, a resolution and its time together, the alert and the recipient existing, attempts not negative, and one message per (alert, recipient, kind)', () => {
    const { store, journeyId, responderIds } = watchedStore();
    const recipientId = responderIds[0] ?? '';
    const open = store.seedAlert({
      journeyId,
      state: 'ESCALATED',
      openedAt: CLOCK_AT,
      silentSince: CLOCK_AT,
    });

    expect(() =>
      store.seedAlert({ journeyId, state: 'OPEN', openedAt: CLOCK_AT, silentSince: CLOCK_AT }),
    ).toThrow(/unique/);
    expect(() =>
      store.seedAlert({
        journeyId,
        state: 'RESOLVED',
        openedAt: CLOCK_AT,
        silentSince: CLOCK_AT,
        resolvedAt: CLOCK_AT,
      }),
    ).toThrow(/check/);
    expect(() =>
      store.seedAlert({
        journeyId,
        state: 'RESOLVED',
        openedAt: CLOCK_AT,
        silentSince: CLOCK_AT,
        resolution: 'HOME',
      }),
    ).toThrow(/check/);
    expect(() =>
      store.seedAlert({
        journeyId: syntheticUuid(),
        state: 'OPEN',
        openedAt: CLOCK_AT,
        silentSince: CLOCK_AT,
      }),
    ).toThrow(/no journey/);
    const message = { alertId: open, recipientId, createdAt: CLOCK_AT, nextAttemptAt: CLOCK_AT };
    store.seedMessage({ ...message, kind: 'LOST_CONTACT' });
    expect(() => store.seedMessage({ ...message, kind: 'LOST_CONTACT' })).toThrow(/unique/);
    expect(() => store.seedMessage({ ...message, kind: 'HOME', alertId: syntheticUuid() })).toThrow(
      /foreign key/,
    );
    expect(() =>
      store.seedMessage({ ...message, kind: 'HOME', recipientId: syntheticUuid() }),
    ).toThrow(/foreign key/);
    expect(() => store.seedMessage({ ...message, kind: 'HOME', attempts: -1 })).toThrow(/check/);
    store.seedMessage({ ...message, kind: 'HOME' });
    expect(store.alerts()).toHaveLength(1);
    expect(store.outbox().map(({ kind }) => kind)).toEqual(['LOST_CONTACT', 'HOME']);
  });

  test('what alerts(), outbox() and endOf() hand back cannot change what it holds, the new times included; and journeys() keeps its shape, with no end in it', async () => {
    const { store, journeyId } = await lostStore(1);
    await store.recordHome(await homeFor(store, journeyId));

    const [alert] = store.alerts();
    const [message] = store.outbox();
    const end = store.endOf(journeyId);
    alert?.resolvedAt?.setTime(0);
    message?.withdrawnAt?.setTime(0);
    end.endedAt?.setTime(0);

    expect(store.alerts()[0]?.resolvedAt).toEqual(CLOCK_AT);
    expect(store.outbox()[0]?.withdrawnAt).toEqual(CLOCK_AT);
    expect(store.endOf(journeyId).endedAt).toEqual(CLOCK_AT);
    expect(Object.keys(store.journeys()[0] ?? {}).sort()).toEqual([
      'id',
      'responderIds',
      'startedAt',
      'state',
      'walkerId',
    ]);
  });

  test('setState to ENDED, as a test’s own setup, sets no end time or reason; removeResponders leaves the journey with none, and refuses a journey never stored', () => {
    const { store, journeyId } = watchedStore();

    store.setState(journeyId, 'ENDED');
    store.removeResponders(journeyId);

    expect(store.endOf(journeyId)).toEqual({ endedAt: null, endReason: null });
    expect(store.journeys()[0]?.responderIds).toEqual([]);
    expect(() => {
      store.removeResponders(syntheticUuid());
    }).toThrow(/no journey/);
    expect(() => store.endOf(syntheticUuid())).toThrow(/no journey/);
  });

  test('the test kit hands out the message kinds, in the server’s order', () => {
    expect(kit.MESSAGE_KINDS).toEqual(['LOST_CONTACT', 'BACK_IN_CONTACT', 'HOME']);
  });
});

describe('fakeJourneyStore: review loop 1 of back in contact and "I’m home" (LOST-03)', () => {
  test('recordHome given a journey ID alone, as before review loop 1, is refused and names what it takes, writing nothing', async () => {
    const { store, journeyId } = await lostStore(1);
    const outbox = store.outbox();

    await expect(
      store.recordHome(journeyId as unknown as Parameters<typeof store.recordHome>[0]),
    ).rejects.toThrow(/\{ journeyId, walkerId, deviceId \}/);

    expect(store.journeys()[0]?.state).toBe('LOST_CONTACT');
    expect(store.outbox()).toEqual(outbox);
  });

  test('a refusal of the home rule under the lock rejects naming the rule’s reason, with the walker’s ID in any case read as the stored one', async () => {
    const { store, journeyId, walkerId, deviceId } = await lostStore(1);
    const stranger = store.addUser();

    await expect(
      store.recordHome({ journeyId, walkerId: stranger, deviceId: store.addDevice(stranger) }),
    ).rejects.toThrow(/JOURNEY_NOT_FOUND/);
    await expect(
      store.recordHome({ journeyId, walkerId, deviceId: store.addDevice(walkerId) }),
    ).rejects.toThrow(/NOT_THE_JOURNEYS_DEVICE/);
    expect(store.endOf(journeyId)).toEqual({ endedAt: null, endReason: null });

    const upper = {
      journeyId: journeyId.toUpperCase(),
      walkerId: walkerId.toUpperCase(),
      deviceId: deviceId.toUpperCase(),
    };
    expect((await store.recordHome(upper)).outcome).toBe('home');
  });

  test('an open that fails, its journey having no responder rows, withdraws no earlier stand-down: the withdrawal is part of the open, all or nothing', async () => {
    const { clock, store, journeyId } = await lostStore(2);
    await store.recordHeartbeat(heartbeat(journeyId, CLOCK_AT));
    const standDowns = store.outbox().filter(({ kind }) => kind === 'BACK_IN_CONTACT');
    expect(standDowns).toHaveLength(2);
    clock.advance(FIVE_MINUTES);
    store.removeResponders(journeyId);
    const outbox = store.outbox();

    await expect(store.openLostContactAlert({ journeyId, afterMs: FIVE_MINUTES })).rejects.toThrow(
      /no responder/,
    );

    expect(store.outbox()).toEqual(outbox);
    expect(store.alerts()).toHaveLength(1);
    expect(store.journeys()[0]?.state).toBe('ACTIVE');
  });

  test('an open withdraws only the journey’s earlier stand-downs: an unsent lost-contact message of an earlier alert, which the code never leaves, is left as it is', async () => {
    const { store, journeyId, responderIds } = watchedStore({ silentForMs: FIVE_MINUTES });
    const earlier = store.seedAlert({
      journeyId,
      state: 'RESOLVED',
      openedAt: CLOCK_AT,
      silentSince: CLOCK_AT,
      resolvedAt: CLOCK_AT,
      resolution: 'BACK_IN_CONTACT',
    });
    const lostContact = store.seedMessage({
      alertId: earlier,
      recipientId: responderIds[0] ?? '',
      kind: 'LOST_CONTACT',
      createdAt: CLOCK_AT,
      nextAttemptAt: CLOCK_AT,
    });
    const standDown = store.seedMessage({
      alertId: earlier,
      recipientId: responderIds[0] ?? '',
      kind: 'BACK_IN_CONTACT',
      createdAt: CLOCK_AT,
      nextAttemptAt: CLOCK_AT,
    });

    expect((await store.openLostContactAlert({ journeyId, afterMs: FIVE_MINUTES })).outcome).toBe(
      'opened',
    );

    const withdrawnAt = new Map(store.outbox().map((m) => [m.messageId, m.withdrawnAt]));
    expect(withdrawnAt.get(standDown)).toEqual(CLOCK_AT);
    expect(withdrawnAt.get(lostContact)).toBeNull();
  });
});
