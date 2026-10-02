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
import { fc, syntheticUuid } from '@trygghverdag/test-kit';
import { describe, expect, test } from 'vitest';
import {
  JOURNEY_EVENTS,
  JOURNEY_STATES,
  transition,
  type JourneyEventType,
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

/** The event each row is asked with, per event type: one valid responder, so the situation decides. */
const EVENT_FOR = {
  start: () => start([RESPONDER]),
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
} satisfies Record<JourneyEventType, Record<Situation, Row>>;

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
    'outcome' in row ? [{ event, situation, expected: row.outcome }] : [],
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

describe('AR-04: the journey state machine is one module, total over its own lists', () => {
  test('SM-01-AC14: the states are exactly ACTIVE, LOST_CONTACT and ENDED, and the only event is start', () => {
    expect([...JOURNEY_STATES].sort()).toEqual(['ACTIVE', 'ENDED', 'LOST_CONTACT']);
    expect([...JOURNEY_EVENTS]).toEqual(['start']);
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

  test('SM-01-AC14: the pairs with an outcome are exactly none, ACTIVE, LOST_CONTACT and ENDED, each with start', () => {
    // ENDED × start joined the three in review: an ENDED journey handed in
    // is "no journey", see its row above.
    expect(OUTCOME_ROWS.map(({ situation, event }) => `${situation} × ${event}`).sort()).toEqual(
      ['ACTIVE × start', 'ENDED × start', 'LOST_CONTACT × start', 'none × start'].sort(),
    );
  });

  test.each(OUTCOME_ROWS)(
    'SM-01-AC14: $situation × $event gives exactly its expected outcome',
    ({ event, situation, expected }) => {
      const build = EVENT_FOR[event as JourneyEventType];

      expect(transition(situationFor(situation), build())).toEqual(expected);
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
