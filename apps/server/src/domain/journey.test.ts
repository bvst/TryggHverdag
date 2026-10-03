// L2 domain: the journey state machine, and the start rule it holds.
//
// SM-01: one unended journey per walker. SM-02, its start rule: a journey
// needs at least one responder to start. Both are decided here, by one pure
// function, and nowhere else — the module around it only reads, asks and
// writes, and the database index is the backstop for two starts that race.
//
// The order of the start rule is part of the rule. A walker who already has a
// journey learns that first, whatever the list says, so an app whose first
// answer was lost in a tunnel always learns which journey it already has and
// can adopt it, rather than leaving one running that it knows nothing about.
//
// Every pair of (situation, event) the module's own lists create has a row in
// TRANSITIONS below. The table is typed over those lists, so a state or an
// event added later without a row is a type error, and the run-time check
// fails naming the pair, because the implementer cannot edit this file. That
// is the state-machine principle in the architecture: every transition has a
// test, and a new feature cannot add an unhandled state quietly.
//
// LOST-01 adds the second event, the heartbeat (approach item 4 of its spec).
// Its rule, in its order, which is part of the rule:
//   1. no journey by that ID, or another walker's → refused, JOURNEY_NOT_FOUND
//      (SEC-07: one answer for both, so it says nothing about other walkers);
//   2. ENDED → ignored, JOURNEY_ENDED (SM-07), before anything else the
//      heartbeat holds, as SM-01 reports an unended journey first;
//   3. not the device that started the journey → refused,
//      NOT_THE_JOURNEYS_DEVICE (D-101), so a tablet left at home can never
//      hide the walking phone's silence;
//   4. otherwise → recorded, and the state stays as it was: ACTIVE stays
//      ACTIVE (SM-03), and LOST_CONTACT stays LOST_CONTACT until the
//      back-in-contact task moves it (reading 7 of the spec).
// The domain never sees the position, the battery or the event ID, so
// whether a heartbeat carried a position changes no outcome: SM-03, held by
// construction, and checked below as a property.
import { fc, syntheticPosition, syntheticUuid } from '@trygghverdag/test-kit';
import { describe, expect, test } from 'vitest';
import {
  JOURNEY_EVENTS,
  JOURNEY_STATES,
  transition,
  type HeartbeatEvent,
  type JourneyEventType,
  type JourneyForHeartbeat,
  type JourneyState,
} from './journey.ts';

/** What `transition` is asked about: the walker's unended journey, or null. */
type Current = Parameters<typeof transition>[0];
type JourneyEvent = Parameters<typeof transition>[1];
type StartEvent = Extract<JourneyEvent, { type: 'start' }>;
type Outcome = ReturnType<typeof transition>;

/** Every state but the one that frees the walker. */
type Unended = Exclude<JourneyState, 'ENDED'>;
const UNENDED: readonly Unended[] = JOURNEY_STATES.filter(
  (state): state is Unended => state !== 'ENDED',
);

const WALKER = syntheticUuid();
const RESPONDER = syntheticUuid();
const OTHER_RESPONDER = syntheticUuid();
const STRANGER = syntheticUuid();
const JOURNEY = syntheticUuid();
/** The device the walker started the journey from. */
const DEVICE = syntheticUuid();
/** Another device of the same walker: a tablet left at home (D-101). */
const OTHER_DEVICE = syntheticUuid();
const OTHER_WALKER = syntheticUuid();
const OTHER_WALKERS_DEVICE = syntheticUuid();

/**
 * A start, with `existingUserIds` worked out as the module works it out: the
 * named IDs that exist as users. The walker exists — a device belongs to a
 * user — so naming the walker puts the walker in the set too.
 */
function start(
  responderIds: readonly string[],
  users: readonly string[] = [WALKER, RESPONDER, OTHER_RESPONDER],
): StartEvent {
  const existing = new Set(users);
  return {
    type: 'start',
    walkerId: WALKER,
    responderIds: [...responderIds],
    existingUserIds: new Set(responderIds.filter((id) => existing.has(id))),
  };
}

function unended(state: Unended, id = JOURNEY): Current {
  return { id, state };
}

const STARTED_WITH = (responderIds: string[]): Outcome => ({
  type: 'started',
  state: 'ACTIVE',
  responderIds,
});
const ALREADY_ON = (journeyId: string): Outcome => ({
  type: 'refused',
  reason: 'ALREADY_ON_A_JOURNEY',
  journeyId,
});
const INVALID_RESPONDER: Outcome = { type: 'refused', reason: 'INVALID_RESPONDER' };
const NO_RESPONDER: Outcome = { type: 'refused', reason: 'NO_RESPONDER' };

/** A heartbeat from this walker's device: the walker's own one unless a test says otherwise. */
function heartbeat(deviceId = DEVICE, walkerId = WALKER): HeartbeatEvent {
  return { type: 'heartbeat', walkerId, deviceId };
}

/** The journey a heartbeat names: the walker's own, started from their device, unless a test says otherwise. */
function named(
  state: JourneyState,
  { walkerId = WALKER, deviceId = DEVICE }: { walkerId?: string; deviceId?: string } = {},
): JourneyForHeartbeat {
  return { id: JOURNEY, state, walkerId, deviceId };
}

const RECORDED_IN = (state: Unended): Outcome => ({ type: 'recorded', state });
const JOURNEY_ENDED: Outcome = { type: 'ignored', reason: 'JOURNEY_ENDED' };
const JOURNEY_NOT_FOUND: Outcome = { type: 'refused', reason: 'JOURNEY_NOT_FOUND' };
const NOT_THE_JOURNEYS_DEVICE: Outcome = { type: 'refused', reason: 'NOT_THE_JOURNEYS_DEVICE' };

// ---------------------------------------------------------------------------
// The transition table.
// ---------------------------------------------------------------------------

/** "none" is the situation with no unended journey; the rest are the journey's state. */
type Situation = 'none' | JourneyState;

/**
 * A row is the outcome the pair must give, or, where the pair is not a
 * situation the event can meet, the reason why — written out, so leaving a
 * pair out is never the same as deciding about it.
 */
type Row = { outcome: Outcome } | { notASituation: string };

/**
 * The event each row is asked with, per event type: for a start, one valid
 * responder; for a heartbeat, the walker's own device. So the situation
 * decides.
 */
const EVENT_FOR = {
  start: () => start([RESPONDER]),
  heartbeat: () => heartbeat(),
} satisfies { [E in JourneyEventType]: () => Extract<JourneyEvent, { type: E }> };

const TRANSITIONS = {
  start: {
    none: { outcome: STARTED_WITH([RESPONDER]) },
    ACTIVE: { outcome: ALREADY_ON(JOURNEY) },
    LOST_CONTACT: { outcome: ALREADY_ON(JOURNEY) },
    // ENDED frees the walker, so an ENDED journey handed in as the current
    // one is no journey at all, and the start goes ahead exactly as from
    // "none". This row was "not a situation" until review: the module never
    // reads an ENDED journey as current, but a caller that passed one got
    // ALREADY_ON_A_JOURNEY naming it, which tells the app to adopt a journey
    // nobody is watching. A refusal pointing at an ended journey is the
    // silent failure; starting is the safe answer.
    ENDED: { outcome: STARTED_WITH([RESPONDER]) },
  },
  // The heartbeat's situation is the journey it names, here the walker's own,
  // started from the device that sends it. Who else's journey it could be is
  // the table below this one.
  heartbeat: {
    none: { outcome: JOURNEY_NOT_FOUND },
    ACTIVE: { outcome: RECORDED_IN('ACTIVE') },
    // Contact while LOST_CONTACT is recorded, and the state stays: the move
    // back to ACTIVE resolves the alert and tells the responders, which is
    // the back-in-contact task's. Until then an open alert stays open, a
    // false alarm that stays loud rather than one closed silently.
    LOST_CONTACT: { outcome: RECORDED_IN('LOST_CONTACT') },
    ENDED: { outcome: JOURNEY_ENDED },
  },
} satisfies Record<JourneyEventType, Record<Situation, Row>>;

/** Which test ID each event's rows prove: the start's are SM-01's, the heartbeat's LOST-01's. */
const ROW_ID = {
  start: 'SM-01-AC14',
  heartbeat: 'LOST-01-AC17',
} satisfies Record<JourneyEventType, string>;

/**
 * The heartbeat's other situations, for every state (SEC-07, D-101): the
 * journey named is another walker's, or the walker's own but started from
 * another of their devices. Typed over the states, so a state added later
 * needs its rows here too.
 */
const HEARTBEAT_FROM_ELSEWHERE = {
  ACTIVE: { anotherWalkers: JOURNEY_NOT_FOUND, anotherDevice: NOT_THE_JOURNEYS_DEVICE },
  LOST_CONTACT: { anotherWalkers: JOURNEY_NOT_FOUND, anotherDevice: NOT_THE_JOURNEYS_DEVICE },
  // Another walker's journey is not found, whatever its state: its state is
  // theirs to know. The walker's own ended journey is reported as ended
  // before the device is looked at.
  ENDED: { anotherWalkers: JOURNEY_NOT_FOUND, anotherDevice: JOURNEY_ENDED },
} satisfies Record<JourneyState, { anotherWalkers: Outcome; anotherDevice: Outcome }>;

const ELSEWHERE_ROWS = Object.entries(HEARTBEAT_FROM_ELSEWHERE).flatMap(([state, rows]) => [
  {
    state,
    whose: 'another walker’s',
    journey: named(state as JourneyState, {
      walkerId: OTHER_WALKER,
      deviceId: OTHER_WALKERS_DEVICE,
    }),
    expected: rows.anotherWalkers,
  },
  {
    state,
    whose: 'the walker’s own, started from another of their devices',
    journey: named(state as JourneyState, { deviceId: OTHER_DEVICE }),
    expected: rows.anotherDevice,
  },
]);

/** Every pair the module's own lists create, read at run time. */
function pairsTheModuleCreates(): string[] {
  const situations: readonly string[] = ['none', ...JOURNEY_STATES];
  return JOURNEY_EVENTS.flatMap((event) =>
    situations.map((situation) => `${situation} × ${event}`),
  );
}

/** Every pair this table holds a row for. */
function pairsThisTableHolds(): string[] {
  return Object.entries(TRANSITIONS).flatMap(([event, rows]) =>
    Object.keys(rows).map((situation) => `${situation} × ${event}`),
  );
}

const OUTCOME_ROWS = Object.entries(TRANSITIONS).flatMap(([event, rows]) =>
  Object.entries(rows).flatMap(([situation, row]: [string, Row]) =>
    'outcome' in row
      ? [{ id: ROW_ID[event as JourneyEventType], event, situation, expected: row.outcome }]
      : [],
  ),
);

/**
 * A situation as `transition` takes it. The cast keeps these tests neutral on
 * whether its parameter type admits an ENDED journey: the table decides which
 * pairs are asked about, and the totality property asks about every state,
 * because no input may escape the function.
 */
function asCurrent(value: { id: string; state: string } | null): Current {
  return value as Current;
}

function situationFor(situation: string): Current {
  return asCurrent(situation === 'none' ? null : { id: JOURNEY, state: situation });
}

/** A heartbeat's situation: the journey it names, the walker's own from their device, or none. */
function heartbeatSituationFor(situation: string): JourneyForHeartbeat | null {
  return situation === 'none' ? null : named(situation as JourneyState);
}

/** What one row of the table comes to: its event, asked in its situation. */
function decide(event: JourneyEventType, situation: string): Outcome {
  switch (event) {
    case 'start':
      return transition(situationFor(situation), EVENT_FOR.start());
    case 'heartbeat':
      return transition(heartbeatSituationFor(situation), EVENT_FOR.heartbeat());
  }
}

describe('AR-04: the journey state machine is one module, total over its own lists', () => {
  test('SM-01-AC14: the states are exactly ACTIVE, LOST_CONTACT and ENDED, and the events exactly start and heartbeat', () => {
    // The events were exactly ['start'] until LOST-01 added the heartbeat
    // (RG-03: an event added by design, LOST-01-AC17 and its spec's approach
    // item 4). The list is still exact, so an event added later has to be
    // named here on purpose.
    expect([...JOURNEY_STATES].sort()).toEqual(['ACTIVE', 'ENDED', 'LOST_CONTACT']);
    expect([...JOURNEY_EVENTS]).toEqual(['start', 'heartbeat']);
  });

  test('SM-01-AC14: every pair of situation and event the module’s lists create has a row here, and no row is stale', () => {
    const created = pairsTheModuleCreates();
    const held = pairsThisTableHolds();

    expect(
      created.filter((pair) => !held.includes(pair)),
      'pairs with no expected outcome in this test: write their rows before the code',
    ).toEqual([]);
    expect(
      held.filter((pair) => !created.includes(pair)),
      'rows for pairs the module no longer creates',
    ).toEqual([]);
  });

  test('SM-01-AC14: the pairs with an outcome are exactly none, ACTIVE, LOST_CONTACT and ENDED, each with start and with heartbeat', () => {
    // ENDED × start joined the three in review: an ENDED journey handed in
    // is "no journey", see its row above. The four heartbeat pairs joined
    // with LOST-01 (RG-03: an event added by design, LOST-01-AC17).
    expect(OUTCOME_ROWS.map(({ situation, event }) => `${situation} × ${event}`).sort()).toEqual(
      [
        'ACTIVE × start',
        'ENDED × start',
        'LOST_CONTACT × start',
        'none × start',
        'ACTIVE × heartbeat',
        'ENDED × heartbeat',
        'LOST_CONTACT × heartbeat',
        'none × heartbeat',
      ].sort(),
    );
  });

  test.each(OUTCOME_ROWS)(
    '$id: $situation × $event gives exactly its expected outcome',
    ({ event, situation, expected }) => {
      // Each event is asked in its own kind of situation: a start meets the
      // walker's unended journey, a heartbeat the journey it names (LOST-01).
      expect(decide(event as JourneyEventType, situation)).toEqual(expected);
    },
  );

  test('SM-01-AC14: for any situation and any start, the outcome is one of the four, never a throw or undefined', () => {
    // Any situation, ENDED included, and any list — repeats, the walker,
    // strangers, existing users the list does not name. "No input escapes it":
    // a journey read wrongly still gets an answer, not an exception.
    const situation = fc.option(
      fc.record({ id: fc.uuid(), state: fc.constantFrom(...JOURNEY_STATES) }),
      { nil: null },
    );
    const anyStart = fc
      .record({
        walkerId: fc.uuid(),
        responderIds: fc.array(fc.oneof(fc.uuid(), fc.string()), { maxLength: 12 }),
        existingUserIds: fc.uniqueArray(fc.oneof(fc.uuid(), fc.string()), { maxLength: 12 }),
      })
      .map(({ walkerId, responderIds, existingUserIds }): StartEvent => ({
        type: 'start',
        walkerId,
        responderIds,
        existingUserIds: new Set(existingUserIds),
      }));

    fc.assert(
      fc.property(situation, anyStart, (current, event) => {
        let outcome: unknown;
        expect(() => {
          outcome = transition(asCurrent(current), event);
        }).not.toThrow();
        expect(outcome).toSatisfy(isOneOfTheFourOutcomes);
      }),
    );
  });
});

/** The four outcomes, with exactly their fields and nothing else. */
function isOneOfTheFourOutcomes(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const outcome = value as Record<string, unknown>;
  const keys = Object.keys(outcome).sort().join(',');
  if (outcome['type'] === 'started') {
    return (
      keys === 'responderIds,state,type' &&
      outcome['state'] === 'ACTIVE' &&
      Array.isArray(outcome['responderIds']) &&
      outcome['responderIds'].every((id) => typeof id === 'string')
    );
  }
  if (outcome['type'] !== 'refused') {
    return false;
  }
  if (outcome['reason'] === 'ALREADY_ON_A_JOURNEY') {
    return keys === 'journeyId,reason,type' && typeof outcome['journeyId'] === 'string';
  }
  return (
    keys === 'reason,type' &&
    (outcome['reason'] === 'INVALID_RESPONDER' || outcome['reason'] === 'NO_RESPONDER')
  );
}

// ---------------------------------------------------------------------------
// The start rule, case by case.
// ---------------------------------------------------------------------------

describe('SM-01: one unended journey per walker', () => {
  test.each(UNENDED)(
    'SM-01-AC2: a walker whose journey is %s cannot start another, and is told which journey it is',
    (state) => {
      expect(transition(unended(state), start([RESPONDER]))).toEqual(ALREADY_ON(JOURNEY));
    },
  );

  test('SM-01-AC2: the journey named is the walker’s own, not a fixed one', () => {
    const other = syntheticUuid();

    expect(transition(unended('ACTIVE', other), start([RESPONDER]))).toEqual(ALREADY_ON(other));
  });

  test('SM-01-AC4: a walker whose only journey has ended has no current journey, so the start goes ahead', () => {
    // The module asks for the walker's unended journey, and an ENDED one is
    // never that, so the situation here is none. The database half — an
    // ENDED row really does not block — is the integration test's.
    expect(transition(null, start([RESPONDER]))).toEqual(STARTED_WITH([RESPONDER]));
  });
});

/** Lists the start rule refuses as INVALID_RESPONDER, by what is wrong with them. */
const INVALID_LISTS = [
  { what: 'the walker alone', list: [WALKER] },
  { what: 'a stranger alone', list: [STRANGER] },
  { what: 'a responder, then the walker', list: [RESPONDER, WALKER] },
  { what: 'the walker, then a responder', list: [WALKER, RESPONDER] },
  { what: 'a responder, then a stranger', list: [RESPONDER, STRANGER] },
  { what: 'a stranger, then a responder', list: [STRANGER, RESPONDER] },
  { what: 'two responders and a stranger last', list: [RESPONDER, OTHER_RESPONDER, STRANGER] },
  { what: 'the walker twice', list: [WALKER, WALKER] },
];

describe('SM-02: at least one responder to start', () => {
  test('SM-01-AC5: an empty list is refused NO_RESPONDER, in its own words', () => {
    expect(transition(null, start([]))).toEqual(NO_RESPONDER);
  });

  test.each(INVALID_LISTS)(
    'SM-01-AC6: a list naming $what is refused whole, INVALID_RESPONDER',
    ({ list }) => {
      expect(transition(null, start(list))).toEqual(INVALID_RESPONDER);
    },
  );

  test('SM-01-AC6: a responder who exists is valid, and one who does not is not, by the set given', () => {
    // The same ID, once known and once not: the decision follows
    // existingUserIds, not anything about the ID itself.
    expect(transition(null, start([STRANGER], [STRANGER]))).toEqual(STARTED_WITH([STRANGER]));
    expect(transition(null, start([RESPONDER], []))).toEqual(INVALID_RESPONDER);
  });

  test('SM-01-AC6: the walker is refused even when the walker is in the set of existing users', () => {
    const event: StartEvent = {
      type: 'start',
      walkerId: WALKER,
      responderIds: [WALKER],
      existingUserIds: new Set([WALKER]),
    };

    expect(transition(null, event)).toEqual(INVALID_RESPONDER);
  });

  test('SM-01-AC6: a responder named twice counts once', () => {
    expect(transition(null, start([RESPONDER, RESPONDER]))).toEqual(STARTED_WITH([RESPONDER]));
  });

  test('SM-01-AC6: repeats count once, and the responders keep the order they were first named in', () => {
    expect(
      transition(null, start([OTHER_RESPONDER, RESPONDER, OTHER_RESPONDER, RESPONDER])),
    ).toEqual(STARTED_WITH([OTHER_RESPONDER, RESPONDER]));
  });

  test('SM-01-AC6: several valid responders all start the journey, in the order named', () => {
    expect(transition(null, start([RESPONDER, OTHER_RESPONDER]))).toEqual(
      STARTED_WITH([RESPONDER, OTHER_RESPONDER]),
    );
  });

  test('SM-01-AC6: the list handed in is not changed by deciding about it', () => {
    const event = start([RESPONDER, RESPONDER]);
    const before = [...event.responderIds];

    transition(null, event);

    expect([...event.responderIds]).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// The order of the rule, as properties.
// ---------------------------------------------------------------------------

/**
 * A walker, some users who exist, some IDs that do not, and a list drawn from
 * all three — empty, the walker, strangers, repeats, or only valid responders.
 */
const people = fc.uniqueArray(fc.uuid(), { minLength: 5, maxLength: 9 }).map((ids) => {
  const [walkerId = '', ...rest] = ids;
  const middle = Math.ceil(rest.length / 2);
  return { walkerId, existing: rest.slice(0, middle), strangers: rest.slice(middle) };
});

const startArbitrary = people.chain(({ walkerId, existing, strangers }) => {
  const anyone = fc.constantFrom(walkerId, ...existing, ...strangers);
  const list = fc.oneof(
    fc.constant<string[]>([]),
    fc.array(fc.constantFrom(...existing), { minLength: 1, maxLength: 8 }),
    fc.array(anyone, { minLength: 1, maxLength: 8 }),
  );
  return list.map((responderIds) => {
    const users = new Set([walkerId, ...existing]);
    const event: StartEvent = {
      type: 'start',
      walkerId,
      responderIds,
      existingUserIds: new Set(responderIds.filter((id) => users.has(id))),
    };
    return event;
  });
});

/** Approach item 2 of the spec, written out once more, independently. */
function expectedOutcome(current: { id: string } | null, event: StartEvent): Outcome {
  if (current !== null) {
    return ALREADY_ON(current.id);
  }
  const ids = [...event.responderIds];
  if (ids.some((id) => id === event.walkerId || !event.existingUserIds.has(id))) {
    return INVALID_RESPONDER;
  }
  if (ids.length === 0) {
    return NO_RESPONDER;
  }
  return STARTED_WITH([...new Set(ids)]);
}

describe('SM-01 and SM-02: the order of the start rule', () => {
  test('SM-01-AC4: an ENDED journey handed in as the current one is no journey: every list gets exactly the outcome it gets with none', () => {
    // Not only the one valid list the table asks with: an empty list is
    // NO_RESPONDER and a bad one INVALID_RESPONDER, never a refusal that
    // names the ended journey.
    fc.assert(
      fc.property(fc.uuid(), startArbitrary, (journeyId, event) => {
        expect(transition(asCurrent({ id: journeyId, state: 'ENDED' }), event)).toEqual(
          expectedOutcome(null, event),
        );
      }),
    );
  });

  test('SM-01-AC7: with an unended journey, every list is refused ALREADY_ON_A_JOURNEY with that journey', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...UNENDED),
        fc.uuid(),
        startArbitrary,
        (state, journeyId, event) => {
          expect(transition({ id: journeyId, state }, event)).toEqual(ALREADY_ON(journeyId));
        },
      ),
    );
  });

  test('SM-01-AC7: with no unended journey, the outcome is exactly the one the rule gives, in its order', () => {
    fc.assert(
      fc.property(startArbitrary, (event) => {
        expect(transition(null, event)).toEqual(expectedOutcome(null, event));
      }),
    );
  });

  test('SM-01-AC7: for any situation at all, the outcome is the rule’s, in its order', () => {
    const situation = fc.option(fc.record({ id: fc.uuid(), state: fc.constantFrom(...UNENDED) }), {
      nil: null,
    });

    fc.assert(
      fc.property(situation, startArbitrary, (current, event) => {
        expect(transition(current, event)).toEqual(expectedOutcome(current, event));
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// The heartbeat rule (LOST-01): SM-03, SM-07, SEC-07 and D-101.
// ---------------------------------------------------------------------------

/** The four outcomes a heartbeat can have, with exactly their fields and nothing else. */
function isOneOfTheHeartbeatOutcomes(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const outcome = value as Record<string, unknown>;
  const keys = Object.keys(outcome).sort().join(',');
  if (outcome['type'] === 'recorded') {
    return (
      keys === 'state,type' &&
      (outcome['state'] === 'ACTIVE' || outcome['state'] === 'LOST_CONTACT')
    );
  }
  if (outcome['type'] === 'ignored') {
    return keys === 'reason,type' && outcome['reason'] === 'JOURNEY_ENDED';
  }
  return (
    outcome['type'] === 'refused' &&
    keys === 'reason,type' &&
    (outcome['reason'] === 'JOURNEY_NOT_FOUND' || outcome['reason'] === 'NOT_THE_JOURNEYS_DEVICE')
  );
}

/** Approach item 4 of LOST-01's spec, written out once more, independently. */
function expectedHeartbeatOutcome(
  journey: JourneyForHeartbeat | null,
  event: HeartbeatEvent,
): Outcome {
  if (journey?.walkerId !== event.walkerId) {
    return JOURNEY_NOT_FOUND;
  }
  if (journey.state === 'ENDED') {
    return JOURNEY_ENDED;
  }
  if (journey.deviceId !== event.deviceId) {
    return NOT_THE_JOURNEYS_DEVICE;
  }
  return RECORDED_IN(journey.state);
}

/**
 * Walkers and devices drawn from small pools, so the generated journeys and
 * heartbeats often share a walker, a device, or both, and every branch of the
 * rule is reached; and now and then any text at all.
 */
const someWalker = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom(WALKER, OTHER_WALKER) },
  { weight: 1, arbitrary: fc.string() },
);
const someDevice = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom(DEVICE, OTHER_DEVICE, OTHER_WALKERS_DEVICE) },
  { weight: 1, arbitrary: fc.string() },
);
const anyJourney: fc.Arbitrary<JourneyForHeartbeat | null> = fc.option(
  fc.record({
    id: fc.uuid(),
    state: fc.constantFrom(...JOURNEY_STATES),
    walkerId: someWalker,
    deviceId: someDevice,
  }),
  { nil: null },
);
const anyHeartbeat: fc.Arbitrary<HeartbeatEvent> = fc
  .record({ walkerId: someWalker, deviceId: someDevice })
  .map(({ walkerId, deviceId }) => heartbeat(deviceId, walkerId));

/**
 * The heartbeat as the phone sent it, everything it carried included. The
 * domain's event type has none of this; a rule that reached for it anyway
 * would show in the properties below.
 */
function asSent(
  event: HeartbeatEvent,
  carried: { position: unknown; batteryLevel: number | null; eventId: string },
): HeartbeatEvent {
  return { ...event, ...carried };
}

describe('LOST-01: a heartbeat for the journey it names, in the rule’s order', () => {
  test('LOST-01-AC17: JOURNEY_EVENTS is exactly start and heartbeat', () => {
    expect([...JOURNEY_EVENTS]).toEqual(['start', 'heartbeat']);
  });

  test.each(ELSEWHERE_ROWS)(
    'LOST-01-AC17: a heartbeat for an $state journey that is $whose gives exactly its expected outcome',
    ({ journey, expected }) => {
      expect(transition(journey, heartbeat())).toEqual(expected);
    },
  );

  test('LOST-01-AC17: the rows from elsewhere cover every state, each from another walker and from another device', () => {
    expect(ELSEWHERE_ROWS.map(({ state }) => state).sort()).toEqual(
      [...JOURNEY_STATES, ...JOURNEY_STATES].sort(),
    );
  });

  test('LOST-01-AC17: for any situation and any heartbeat, the outcome is the rule’s, in its order', () => {
    fc.assert(
      fc.property(anyJourney, anyHeartbeat, (journey, event) => {
        expect(transition(journey, event)).toEqual(expectedHeartbeatOutcome(journey, event));
      }),
    );
  });

  test('LOST-01-AC17: for any situation and any heartbeat, the outcome is one of the four, never a throw or undefined', () => {
    fc.assert(
      fc.property(anyJourney, anyHeartbeat, (journey, event) => {
        let outcome: unknown;
        expect(() => {
          outcome = transition(journey, event);
        }).not.toThrow();
        expect(outcome).toSatisfy(isOneOfTheHeartbeatOutcomes);
      }),
    );
  });

  test('LOST-01-AC17: for any situation and any event of either kind, transition answers with a value: never a throw, never undefined', () => {
    const anyStart = fc
      .record({
        walkerId: someWalker,
        responderIds: fc.array(fc.oneof(fc.uuid(), someWalker), { maxLength: 6 }),
        existingUserIds: fc.uniqueArray(fc.oneof(fc.uuid(), someWalker), { maxLength: 6 }),
      })
      .map(({ walkerId, responderIds, existingUserIds }): StartEvent => ({
        type: 'start',
        walkerId,
        responderIds,
        existingUserIds: new Set(existingUserIds),
      }));
    const anyEvent: fc.Arbitrary<JourneyEvent> = fc.oneof(anyStart, anyHeartbeat);

    fc.assert(
      fc.property(anyJourney, anyEvent, (journey, event) => {
        let outcome: unknown;
        expect(() => {
          outcome = transition(journey, event);
        }).not.toThrow();
        expect(outcome).toBeDefined();
        expect(outcome).toSatisfy((value: unknown) =>
          event.type === 'heartbeat'
            ? isOneOfTheHeartbeatOutcomes(value)
            : isOneOfTheFourOutcomes(value),
        );
      }),
    );
  });

  test('LOST-01-AC17: an event of a type the module does not list is thrown on in every situation, never answered with a value', () => {
    // The switch's default holds `const unhandled: never = event` and throws:
    // a value handed back for an event nobody handled is a silent miss for
    // whatever reads the outcome.
    const unlisted = {
      type: 'teleport',
      walkerId: WALKER,
      deviceId: DEVICE,
    } as unknown as HeartbeatEvent;

    for (const journey of [null, ...JOURNEY_STATES.map((state) => named(state))]) {
      expect(() => transition(journey, unlisted), journey?.state ?? 'none').toThrow();
    }
  });

  test('LOST-01-AC17: deciding about a heartbeat changes neither the journey nor the heartbeat handed in', () => {
    const journey = named('ACTIVE');
    const event = heartbeat();
    const before = { journey: { ...journey }, event: { ...event } };

    transition(journey, event);

    expect({ journey, event }).toEqual(before);
  });
});

describe('SM-03: a heartbeat keeps a journey as it is, with a position or without', () => {
  test('LOST-01-AC2: a heartbeat with no position keeps an ACTIVE journey ACTIVE, exactly as one with a position does', () => {
    const carried = { batteryLevel: 0.734375, eventId: 'synthetic-event-0001' };

    expect(
      transition(named('ACTIVE'), asSent(heartbeat(), { ...carried, position: null })),
    ).toEqual(RECORDED_IN('ACTIVE'));
    expect(
      transition(
        named('ACTIVE'),
        asSent(heartbeat(), { ...carried, position: syntheticPosition() }),
      ),
    ).toEqual(RECORDED_IN('ACTIVE'));
  });

  test('LOST-01-AC2: for any sequence of heartbeats, with and without positions, every outcome is the one the same heartbeats get with positions: whether a position came changes nothing', () => {
    const sequence = fc.array(
      fc.record({
        event: anyHeartbeat,
        hasPosition: fc.boolean(),
        batteryLevel: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: null }),
      }),
      { maxLength: 20 },
    );

    fc.assert(
      fc.property(anyJourney, sequence, (start, heartbeats) => {
        let asItCame = start;
        let allWithPositions = start;
        for (const [index, { event, hasPosition, batteryLevel }] of heartbeats.entries()) {
          const eventId = `synthetic-event-${String(index)}`;
          const withPosition = transition(
            allWithPositions,
            asSent(event, { position: syntheticPosition(), batteryLevel, eventId }),
          );
          const came = transition(
            asItCame,
            asSent(event, {
              position: hasPosition ? syntheticPosition() : null,
              batteryLevel,
              eventId,
            }),
          );

          expect(came).toEqual(withPosition);
          expect(came).toEqual(transition(asItCame, event));
          // A recorded heartbeat leaves the journey in the state it was in.
          if (came.type === 'recorded' && asItCame !== null) {
            expect(came.state).toBe(asItCame.state);
            asItCame = { ...asItCame, state: came.state };
          }
          if (withPosition.type === 'recorded' && allWithPositions !== null) {
            allWithPositions = { ...allWithPositions, state: withPosition.state };
          }
        }
      }),
    );
  });

  test('LOST-01-AC8: a journey in LOST_CONTACT takes the heartbeat and stays LOST_CONTACT, with a position or without', () => {
    for (const position of [syntheticPosition(), null]) {
      expect(
        transition(
          named('LOST_CONTACT'),
          asSent(heartbeat(), { position, batteryLevel: null, eventId: 'synthetic-event-0002' }),
        ),
      ).toEqual(RECORDED_IN('LOST_CONTACT'));
    }
  });
});

describe('SM-07: a heartbeat for an ended journey is ignored, and reported first', () => {
  test('LOST-01-AC7: an ENDED journey is ignored, JOURNEY_ENDED, from its starting device and from another of the walker’s', () => {
    expect(transition(named('ENDED'), heartbeat())).toEqual(JOURNEY_ENDED);
    expect(transition(named('ENDED'), heartbeat(OTHER_DEVICE))).toEqual(JOURNEY_ENDED);
  });

  test('LOST-01-AC7: for any heartbeat of the walker’s, from any device, an ENDED journey is JOURNEY_ENDED', () => {
    fc.assert(
      fc.property(fc.uuid(), someDevice, someDevice, (id, startedFrom, sentFrom) => {
        expect(
          transition(
            { id, state: 'ENDED', walkerId: WALKER, deviceId: startedFrom },
            heartbeat(sentFrom),
          ),
        ).toEqual(JOURNEY_ENDED);
      }),
    );
  });
});

describe('SEC-07: a heartbeat only for the walker’s own journey, from the device that started it', () => {
  test('LOST-01-AC9: no journey by that ID is JOURNEY_NOT_FOUND', () => {
    expect(transition(null, heartbeat())).toEqual(JOURNEY_NOT_FOUND);
  });

  test.each(JOURNEY_STATES)(
    'LOST-01-AC9: another walker’s %s journey is JOURNEY_NOT_FOUND, the same answer as none, even from the device that started it',
    (state) => {
      expect(transition(named(state, { walkerId: OTHER_WALKER }), heartbeat())).toEqual(
        JOURNEY_NOT_FOUND,
      );
      expect(
        transition(
          named(state, { walkerId: OTHER_WALKER, deviceId: OTHER_WALKERS_DEVICE }),
          heartbeat(),
        ),
      ).toEqual(transition(null, heartbeat()));
    },
  );

  test.each(UNENDED)(
    'LOST-01-AC10: the walker’s %s journey, started from another of their devices, is refused NOT_THE_JOURNEYS_DEVICE (D-101)',
    (state) => {
      expect(transition(named(state, { deviceId: OTHER_DEVICE }), heartbeat())).toEqual(
        NOT_THE_JOURNEYS_DEVICE,
      );
      expect(transition(named(state), heartbeat(OTHER_DEVICE))).toEqual(NOT_THE_JOURNEYS_DEVICE);
    },
  );

  test.each(UNENDED)(
    'LOST-01-AC10: the walker’s %s journey takes the heartbeat from the device that started it',
    (state) => {
      expect(transition(named(state), heartbeat())).toEqual(RECORDED_IN(state));
    },
  );
});
