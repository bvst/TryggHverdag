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
//
// LOST-02 adds the third event, silence (approach item 2 of its spec): the
// watchdog's question, asked with two database times the store read, when the
// journey's silence began and now. An ACTIVE journey silent for
// LOST_CONTACT_AFTER_MS or more (D-021, "or more") moves to LOST_CONTACT and
// opens an alert; every other situation is unchanged: ACTIVE under the
// threshold, LOST_CONTACT (once per silence), ENDED, and no journey. The rule
// reads no clock: both times are handed in.
//
// LOST-03 adds the fourth and fifth events (approach item 2 of its spec):
//   - contact, the store's question under the row lock, after it stored a
//     heartbeat: with the journey's silence counted with that heartbeat and
//     the transaction's now, a LOST_CONTACT journey is back in contact
//     exactly when the silence is under LOST_CONTACT_AFTER_MS, the silence
//     rule asked the other way at the same threshold. Every other situation
//     is unchanged, and so is any time that is not one;
//   - home (D-110), "I'm home", in the heartbeat rule's order: no journey or
//     another walker's is not found; ENDED is ignored (SM-07); another device
//     of the walker's is refused (D-101); ACTIVE ends, HOME, resolving no
//     alert; LOST_CONTACT ends, HOME, resolving its alert (SM-04).
// The heartbeat's own rule does not change: a LOST_CONTACT journey's
// heartbeat is recorded and the state stays; the move back is contact's.
import { fc, syntheticPosition, syntheticUuid } from '@trygghverdag/test-kit';
import { describe, expect, test } from 'vitest';
import {
  ALERT_RESOLUTIONS,
  ALERT_STATES,
  JOURNEY_END_REASONS,
  JOURNEY_EVENTS,
  JOURNEY_STATES,
  LOST_CONTACT_AFTER_MS,
  MESSAGE_KINDS,
  transition,
  type AlertResolution,
  type ContactEvent,
  type HeartbeatEvent,
  type HomeEvent,
  type JourneyEndReason,
  type JourneyEventType,
  type JourneyForHeartbeat,
  type JourneyState,
  type MessageKind,
  type SilenceEvent,
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

/** When the silence of the table's rows began: a synthetic night, in database time. */
const SILENT_SINCE = new Date('2026-10-01T21:30:00.000Z');

/** The watchdog asks about a silence that began at `silentSince` and has lasted `silentForMs`. */
function silence(silentForMs: number, silentSince: Date = SILENT_SINCE): SilenceEvent {
  return {
    type: 'silence',
    silentSince,
    now: new Date(silentSince.getTime() + silentForMs),
  };
}

const LOST_CONTACT: Outcome = { type: 'lost_contact', state: 'LOST_CONTACT', alert: 'OPEN' };
const UNCHANGED: Outcome = { type: 'unchanged' };

/**
 * LOST-03: the store asks, after it stored a heartbeat, whether contact is
 * back: the journey's silence, counted with that heartbeat, began at
 * `silentSince` and has lasted `silentForMs` by the transaction's now.
 */
function contact(silentForMs: number, silentSince: Date = SILENT_SINCE): ContactEvent {
  return {
    type: 'contact',
    silentSince,
    now: new Date(silentSince.getTime() + silentForMs),
  };
}

/** LOST-03 (D-110): "I'm home", from this walker's device: the walker's own one unless a test says otherwise. */
function home(deviceId = DEVICE, walkerId = WALKER): HomeEvent {
  return { type: 'home', walkerId, deviceId };
}

const BACK_IN_CONTACT: Outcome = { type: 'back_in_contact', state: 'ACTIVE', alert: 'RESOLVED' };
const ENDED_HOME = (resolvesAlert: boolean): Outcome => ({
  type: 'ended',
  state: 'ENDED',
  reason: 'HOME',
  resolvesAlert,
});

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
  // LOST-02: at the threshold exactly, so the situation decides. The rows
  // under the threshold are SILENCE_UNDER_THE_THRESHOLD, below the table.
  silence: () => silence(LOST_CONTACT_AFTER_MS),
  // LOST-03: contact at the threshold exactly, where nothing is back in
  // contact: five minutes is lost, by the watchdog's own rule. The rows one
  // millisecond under it are CONTACT_UNDER_THE_THRESHOLD, below the table.
  contact: () => contact(LOST_CONTACT_AFTER_MS),
  // LOST-03 (D-110): "I'm home" from the walker's own device, so the
  // situation decides. The other senders are HOME_FROM_ELSEWHERE, below.
  home: () => home(),
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
  // LOST-02: silence, five minutes of it exactly (D-021, "or more"). Only an
  // ACTIVE journey is alerted. LOST_CONTACT is never alerted again: once per
  // silence (reading 7 of the spec). ENDED and no journey have nobody to
  // watch.
  silence: {
    none: { outcome: UNCHANGED },
    ACTIVE: { outcome: LOST_CONTACT },
    LOST_CONTACT: { outcome: UNCHANGED },
    ENDED: { outcome: UNCHANGED },
  },
  // LOST-03: contact, five minutes of silence exactly. Nothing is back: five
  // minutes is the watchdog's "lost", so the two rules never disagree at the
  // boundary. Under it, LOST_CONTACT moves back (the table below this one).
  contact: {
    none: { outcome: UNCHANGED },
    ACTIVE: { outcome: UNCHANGED },
    LOST_CONTACT: { outcome: UNCHANGED },
    ENDED: { outcome: UNCHANGED },
  },
  // LOST-03 (D-110): "I'm home" from the walker's own device. ACTIVE ends
  // with no alert to resolve; LOST_CONTACT ends and resolves it (SM-04); an
  // ENDED journey is ignored (SM-07); no journey is not found.
  home: {
    none: { outcome: JOURNEY_NOT_FOUND },
    ACTIVE: { outcome: ENDED_HOME(false) },
    LOST_CONTACT: { outcome: ENDED_HOME(true) },
    ENDED: { outcome: JOURNEY_ENDED },
  },
} satisfies Record<JourneyEventType, Record<Situation, Row>>;

/**
 * LOST-03-AC3: contact one millisecond under the threshold, in every
 * situation: only LOST_CONTACT moves, back to ACTIVE, resolving its alert.
 * Typed over the situations, so a state added later needs its row here too.
 */
const CONTACT_UNDER_THE_THRESHOLD = {
  none: UNCHANGED,
  ACTIVE: UNCHANGED,
  LOST_CONTACT: BACK_IN_CONTACT,
  ENDED: UNCHANGED,
} satisfies Record<Situation, Outcome>;

/**
 * LOST-03-AC3: "I'm home" from elsewhere, for every state (D-101, D-110):
 * another walker's journey is not found, whatever its state; the walker's own
 * from another of their devices is refused, unless it has ENDED, which is
 * reported first. Typed over the states, so a state added later needs its
 * rows here too.
 */
const HOME_FROM_ELSEWHERE = {
  ACTIVE: { anotherWalkers: JOURNEY_NOT_FOUND, anotherDevice: NOT_THE_JOURNEYS_DEVICE },
  LOST_CONTACT: { anotherWalkers: JOURNEY_NOT_FOUND, anotherDevice: NOT_THE_JOURNEYS_DEVICE },
  ENDED: { anotherWalkers: JOURNEY_NOT_FOUND, anotherDevice: JOURNEY_ENDED },
} satisfies Record<JourneyState, { anotherWalkers: Outcome; anotherDevice: Outcome }>;

/**
 * LOST-02-AC6: silence one millisecond under the threshold, in every
 * situation: nothing changes, ACTIVE included. Typed over the situations, so
 * a state added later needs its row here too.
 */
const SILENCE_UNDER_THE_THRESHOLD = {
  none: UNCHANGED,
  ACTIVE: UNCHANGED,
  LOST_CONTACT: UNCHANGED,
  ENDED: UNCHANGED,
} satisfies Record<Situation, Outcome>;

/** Which test ID each event's rows prove: the start's are SM-01's, the heartbeat's LOST-01's, silence's LOST-02's. */
const ROW_ID = {
  start: 'SM-01-AC14',
  heartbeat: 'LOST-01-AC17',
  silence: 'LOST-02-AC6',
  contact: 'LOST-03-AC3',
  home: 'LOST-03-AC3',
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
    case 'silence':
      // The watchdog's situation is the journey it read, by its ID and state.
      return transition(situationFor(situation), EVENT_FOR.silence());
    case 'contact':
      // The store's situation is the journey whose row it locked, by its ID and state.
      return transition(situationFor(situation), EVENT_FOR.contact());
    case 'home':
      // "I'm home" names a journey, as a heartbeat does (D-110).
      return transition(heartbeatSituationFor(situation), EVENT_FOR.home());
  }
}

describe('AR-04: the journey state machine is one module, total over its own lists', () => {
  test('SM-01-AC14: the states are exactly ACTIVE, LOST_CONTACT and ENDED, and the events exactly start, heartbeat, silence, contact and home', () => {
    // The events were exactly ['start'] until LOST-01 added the heartbeat
    // (RG-03: an event added by design, LOST-01-AC17 and its spec's approach
    // item 4). The list is still exact, so an event added later has to be
    // named here on purpose.
    //
    // RG-03 (LOST-02): silence joins by design, the watchdog's event
    // (LOST-02-AC6, its spec's approach item 2, and "Existing assertions that
    // change by design"). The list is still pinned exactly, in order.
    //
    // RG-03 (LOST-03): contact and home join by design (LOST-03-AC3, its
    // spec's approach item 2, and "Existing assertions that change by
    // design", which names this file's JOURNEY_EVENTS pin). The states do not
    // change; the list is still pinned exactly, in order.
    expect([...JOURNEY_STATES].sort()).toEqual(['ACTIVE', 'ENDED', 'LOST_CONTACT']);
    expect([...JOURNEY_EVENTS]).toEqual(['start', 'heartbeat', 'silence', 'contact', 'home']);
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

  test('SM-01-AC14: the pairs with an outcome are exactly none, ACTIVE, LOST_CONTACT and ENDED, each with start, with heartbeat, with silence, with contact and with home', () => {
    // ENDED × start joined the three in review: an ENDED journey handed in
    // is "no journey", see its row above. The four heartbeat pairs joined
    // with LOST-01 (RG-03: an event added by design, LOST-01-AC17).
    //
    // RG-03 (LOST-02): the four silence pairs join by design (LOST-02-AC6).
    // Every pair that was here still is, with the same outcome.
    //
    // RG-03 (LOST-03): the four contact pairs and the four home pairs join by
    // design (LOST-03-AC3: "the transition table holds an expectation for
    // every pair"). Every pair that was here still is, with the same outcome.
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
        'ACTIVE × silence',
        'ENDED × silence',
        'LOST_CONTACT × silence',
        'none × silence',
        'ACTIVE × contact',
        'ENDED × contact',
        'LOST_CONTACT × contact',
        'none × contact',
        'ACTIVE × home',
        'ENDED × home',
        'LOST_CONTACT × home',
        'none × home',
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
  test('LOST-01-AC17: JOURNEY_EVENTS is exactly start and heartbeat, and then silence, contact and home', () => {
    // RG-03 (LOST-02): silence is added after the heartbeat by design
    // (LOST-02-AC6). Start and heartbeat keep their places; the pin is exact.
    //
    // RG-03 (LOST-03): contact and home are added after silence by design
    // (LOST-03-AC3). Start and heartbeat keep their places; the pin is exact.
    expect([...JOURNEY_EVENTS]).toEqual(['start', 'heartbeat', 'silence', 'contact', 'home']);
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

// ===========================================================================
// LOST-02: silence. The watchdog's question, on the database's clock.
// ===========================================================================

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Every situation silence can meet, as `transition` takes it: no journey, or one in any state. */
const SITUATIONS: readonly Situation[] = ['none', ...JOURNEY_STATES];

/** A silence event that began at `silentSince` and is asked about at `now`, both any moment. */
function silenceBetween(silentSince: Date, now: Date): SilenceEvent {
  return { type: 'silence', silentSince, now };
}

/** Any moment, an invalid one included: no input may escape the rule (LOST-02-AC6). */
const anyMoment: fc.Arbitrary<Date> = fc.oneof(
  { weight: 9, arbitrary: fc.date({ noInvalidDate: true }) },
  { weight: 1, arbitrary: fc.constant(new Date(Number.NaN)) },
);

/** The silence outcomes, with exactly their fields and nothing else. */
function isOneOfTheSilenceOutcomes(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const outcome = value as Record<string, unknown>;
  const keys = Object.keys(outcome).sort().join(',');
  if (outcome['type'] === 'unchanged') {
    return keys === 'type';
  }
  return (
    outcome['type'] === 'lost_contact' &&
    keys === 'alert,state,type' &&
    outcome['state'] === 'LOST_CONTACT' &&
    outcome['alert'] === 'OPEN'
  );
}

describe('LOST-02: every pair, silence included, has a tested outcome', () => {
  test('LOST-02-AC6: JOURNEY_EVENTS is exactly start, heartbeat, silence, contact and home, and ALERT_STATES exactly OPEN, ESCALATED, ACKNOWLEDGED and RESOLVED, in order (D-033)', () => {
    // RG-03 (LOST-03, the spec's "Existing assertions that change by
    // design"): JOURNEY_EVENTS gains contact and home, after silence. The
    // alert states do not change. Both lists are still pinned exactly.
    expect([...JOURNEY_EVENTS]).toEqual(['start', 'heartbeat', 'silence', 'contact', 'home']);
    expect([...ALERT_STATES]).toEqual(['OPEN', 'ESCALATED', 'ACKNOWLEDGED', 'RESOLVED']);
  });

  test('LOST-02-AC6: the module’s lists create a silence pair for none and for every state, and the table holds each one; a pair it lacked would be named', () => {
    const created = pairsTheModuleCreates().filter((pair) => pair.endsWith('× silence'));
    const held = pairsThisTableHolds();

    expect([...created].sort()).toEqual(
      ['none × silence', 'ACTIVE × silence', 'LOST_CONTACT × silence', 'ENDED × silence'].sort(),
    );
    expect(created.filter((pair) => !held.includes(pair))).toEqual([]);
    expect(Object.keys(SILENCE_UNDER_THE_THRESHOLD).sort()).toEqual([...SITUATIONS].sort());
  });

  test.each(SITUATIONS)(
    'LOST-02-AC6: %s × silence one millisecond under the threshold gives exactly its outcome: unchanged',
    (situation) => {
      expect(transition(situationFor(situation), silence(LOST_CONTACT_AFTER_MS - 1))).toEqual(
        SILENCE_UNDER_THE_THRESHOLD[situation],
      );
    },
  );

  test('LOST-02-AC6: for any situation and any silence, any moments, an invalid one included, transition answers one of the two outcomes: never a throw, never undefined', () => {
    const anySituation = fc.option(
      fc.record({ id: fc.uuid(), state: fc.constantFrom(...JOURNEY_STATES) }),
      { nil: null },
    );

    fc.assert(
      fc.property(anySituation, anyMoment, anyMoment, (current, silentSince, now) => {
        let outcome: unknown;
        expect(() => {
          outcome = transition(asCurrent(current), silenceBetween(silentSince, now));
        }).not.toThrow();
        expect(outcome).toBeDefined();
        expect(outcome).toSatisfy(isOneOfTheSilenceOutcomes);
      }),
    );
  });

  test('LOST-02-AC6: for any situation and any event of the three kinds, transition answers with a value: never a throw, never undefined', () => {
    const anySilence = fc
      .record({ silentSince: anyMoment, now: anyMoment })
      .map(({ silentSince, now }) => silenceBetween(silentSince, now));
    const anyEvent: fc.Arbitrary<JourneyEvent> = fc.oneof(
      fc.constant(start([RESPONDER])),
      anyHeartbeat,
      anySilence,
    );

    fc.assert(
      fc.property(anyJourney, anyEvent, (journey, event) => {
        let outcome: unknown;
        expect(() => {
          outcome = transition(journey, event);
        }).not.toThrow();
        expect(outcome).toBeDefined();
      }),
    );
  });

  test('LOST-02-AC6: deciding about silence changes neither the journey nor the event handed in', () => {
    const journey = { id: JOURNEY, state: 'ACTIVE' as const };
    const event = silence(LOST_CONTACT_AFTER_MS);
    const before = {
      journey: { ...journey },
      silentSince: event.silentSince.getTime(),
      now: event.now.getTime(),
    };

    transition(journey, event);

    expect(journey).toEqual(before.journey);
    expect(event.silentSince.getTime()).toBe(before.silentSince);
    expect(event.now.getTime()).toBe(before.now);
    expect(event.type).toBe('silence');
  });
});

describe('LOST-02: five minutes of silence, or more, by the database clock', () => {
  test('LOST-02-AC2: LOST_CONTACT_AFTER_MS is five minutes (D-021)', () => {
    expect(LOST_CONTACT_AFTER_MS).toBe(5 * MINUTE);
  });

  test('LOST-02-AC2: an ACTIVE journey silent for exactly five minutes is lost, and one millisecond less is not: five minutes or more', () => {
    const active = asCurrent({ id: JOURNEY, state: 'ACTIVE' });

    expect(transition(active, silence(LOST_CONTACT_AFTER_MS - 1))).toEqual(UNCHANGED);
    expect(transition(active, silence(LOST_CONTACT_AFTER_MS))).toEqual(LOST_CONTACT);
    expect(transition(active, silence(LOST_CONTACT_AFTER_MS + 1))).toEqual(LOST_CONTACT);
    expect(transition(active, silence(10 * HOUR))).toEqual(LOST_CONTACT);
  });

  test('LOST-02-AC2: for any moment silence began and any moment it is asked about, an ACTIVE journey is lost exactly when the second is five minutes or more after the first, a clock that ran backwards included', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -HOUR, max: 3 * HOUR }),
        fc.integer({ min: 0, max: 400 * 24 * HOUR }),
        (silentForMs, offsetMs) => {
          const silentSince = new Date(SILENT_SINCE.getTime() + offsetMs);
          const outcome = transition(
            asCurrent({ id: JOURNEY, state: 'ACTIVE' }),
            silence(silentForMs, silentSince),
          );

          expect(outcome).toEqual(silentForMs >= LOST_CONTACT_AFTER_MS ? LOST_CONTACT : UNCHANGED);
        },
      ),
    );
  });

  test('LOST-02-AC2: for any sequence of heartbeats and sweeps, a journey silent for five minutes is LOST_CONTACT after the next sweep, one never silent that long never is, and a heartbeat never moves it back (the testing strategy’s L2 example)', () => {
    // A timeline: each step comes some time after the one before. A
    // heartbeat is decided by the heartbeat rule and moves last contact to
    // its time; a sweep asks about the silence since last contact, or since
    // the start when there has been none, and applies what it is told.
    const step = fc.record({
      afterMs: fc.oneof(
        fc.integer({ min: 0, max: 7 * MINUTE }),
        fc.constantFrom(LOST_CONTACT_AFTER_MS - 1, LOST_CONTACT_AFTER_MS),
      ),
      kind: fc.constantFrom('heartbeat' as const, 'sweep' as const),
    });

    fc.assert(
      fc.property(fc.array(step, { maxLength: 40 }), (steps) => {
        let elapsedMs = 0;
        let lastContactMs = 0;
        let state: Unended = 'ACTIVE';
        let silentLongEnough = false;

        for (const { afterMs, kind } of steps) {
          elapsedMs += afterMs;
          if (kind === 'heartbeat') {
            expect(transition(named(state), heartbeat())).toEqual(RECORDED_IN(state));
            lastContactMs = elapsedMs;
            continue;
          }
          const outcome = transition(
            asCurrent({ id: JOURNEY, state }),
            silenceBetween(
              new Date(SILENT_SINCE.getTime() + lastContactMs),
              new Date(SILENT_SINCE.getTime() + elapsedMs),
            ),
          );
          const due = state === 'ACTIVE' && elapsedMs - lastContactMs >= LOST_CONTACT_AFTER_MS;
          expect(outcome).toEqual(due ? LOST_CONTACT : UNCHANGED);
          if (due) {
            state = 'LOST_CONTACT';
          }
          silentLongEnough ||= elapsedMs - lastContactMs >= LOST_CONTACT_AFTER_MS;
          expect(state).toBe(silentLongEnough ? 'LOST_CONTACT' : 'ACTIVE');
        }
      }),
    );
  });

  test('LOST-02-AC3: a journey that never sent a heartbeat is timed from its start: at 4:59.999 after it nothing changes, at 5:00 it is lost', () => {
    // The store hands in the start as silentSince when there is no last
    // contact: coalesce(last_heartbeat_at, started_at). The rule only sees
    // the moment, so the start counts exactly as last contact would.
    const startedAt = new Date('2026-10-01T21:05:00.000Z');
    const active = asCurrent({ id: JOURNEY, state: 'ACTIVE' });

    expect(transition(active, silence(LOST_CONTACT_AFTER_MS - 1, startedAt))).toEqual(UNCHANGED);
    expect(transition(active, silence(LOST_CONTACT_AFTER_MS, startedAt))).toEqual(LOST_CONTACT);
  });
});

describe('SM-03 and LOST-02: only an ACTIVE journey is alerted, once per silence', () => {
  test('LOST-02-AC5: a journey already LOST_CONTACT, an ENDED one, and no journey at all are never alerted, however long the silence', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<Situation>('none', 'LOST_CONTACT', 'ENDED'),
        fc.integer({ min: -HOUR, max: 48 * HOUR }),
        (situation, silentForMs) => {
          expect(transition(situationFor(situation), silence(silentForMs))).toEqual(UNCHANGED);
        },
      ),
    );
  });

  test('LOST-02-AC5: a heartbeat for a journey in LOST_CONTACT is recorded and leaves it LOST_CONTACT, and the next silence alerts it no more: moving it back is the back-in-contact task’s', () => {
    expect(transition(named('LOST_CONTACT'), heartbeat())).toEqual(RECORDED_IN('LOST_CONTACT'));
    expect(
      transition(asCurrent({ id: JOURNEY, state: 'LOST_CONTACT' }), silence(10 * HOUR)),
    ).toEqual(UNCHANGED);
  });
});

// ===========================================================================
// LOST-03: contact, the store's question once a heartbeat is stored, and
// "I'm home" (SM-04, D-110).
// ===========================================================================

/** The contact outcomes, with exactly their fields and nothing else. */
function isOneOfTheContactOutcomes(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const outcome = value as Record<string, unknown>;
  const keys = Object.keys(outcome).sort().join(',');
  if (outcome['type'] === 'unchanged') {
    return keys === 'type';
  }
  return (
    outcome['type'] === 'back_in_contact' &&
    keys === 'alert,state,type' &&
    outcome['state'] === 'ACTIVE' &&
    outcome['alert'] === 'RESOLVED'
  );
}

/** The "I'm home" outcomes, with exactly their fields and nothing else. */
function isOneOfTheHomeOutcomes(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const outcome = value as Record<string, unknown>;
  const keys = Object.keys(outcome).sort().join(',');
  if (outcome['type'] === 'ended') {
    return (
      keys === 'reason,resolvesAlert,state,type' &&
      outcome['state'] === 'ENDED' &&
      outcome['reason'] === 'HOME' &&
      typeof outcome['resolvesAlert'] === 'boolean'
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

/** Approach item 2 of LOST-03's spec, the home rule, written out once more, independently. */
function expectedHomeOutcome(journey: JourneyForHeartbeat | null, event: HomeEvent): Outcome {
  if (journey?.walkerId !== event.walkerId) {
    return JOURNEY_NOT_FOUND;
  }
  if (journey.state === 'ENDED') {
    return JOURNEY_ENDED;
  }
  if (journey.deviceId !== event.deviceId) {
    return NOT_THE_JOURNEYS_DEVICE;
  }
  return ENDED_HOME(journey.state === 'LOST_CONTACT');
}

const anyHome: fc.Arbitrary<HomeEvent> = fc
  .record({ walkerId: someWalker, deviceId: someDevice })
  .map(({ walkerId, deviceId }) => home(deviceId, walkerId));

const anyContact: fc.Arbitrary<ContactEvent> = fc
  .record({ silentSince: anyMoment, now: anyMoment })
  .map(({ silentSince, now }) => ({ type: 'contact' as const, silentSince, now }));

const HOME_ROWS = Object.entries(HOME_FROM_ELSEWHERE).flatMap(([state, rows]) => [
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

describe('LOST-03: every pair, contact and "I’m home" included, has a tested outcome', () => {
  test('LOST-03-AC3: JOURNEY_EVENTS is exactly start, heartbeat, silence, contact and home, in order', () => {
    expect([...JOURNEY_EVENTS]).toEqual(['start', 'heartbeat', 'silence', 'contact', 'home']);
  });

  test('LOST-03-AC3: the module’s lists create a contact pair and a home pair for none and for every state, and the table holds each one; a pair it lacked would be named', () => {
    const created = pairsTheModuleCreates().filter(
      (pair) => pair.endsWith('× contact') || pair.endsWith('× home'),
    );
    const held = pairsThisTableHolds();

    expect([...created].sort()).toEqual(
      SITUATIONS.flatMap((situation) => [`${situation} × contact`, `${situation} × home`]).sort(),
    );
    expect(created.filter((pair) => !held.includes(pair))).toEqual([]);
    expect(Object.keys(CONTACT_UNDER_THE_THRESHOLD).sort()).toEqual([...SITUATIONS].sort());
    expect(Object.keys(HOME_FROM_ELSEWHERE).sort()).toEqual([...JOURNEY_STATES].sort());
  });

  test.each(SITUATIONS)(
    'LOST-03-AC3: %s × contact one millisecond under the threshold gives exactly its outcome',
    (situation) => {
      expect(transition(situationFor(situation), contact(LOST_CONTACT_AFTER_MS - 1))).toEqual(
        CONTACT_UNDER_THE_THRESHOLD[situation],
      );
    },
  );

  test.each(HOME_ROWS)(
    'LOST-03-AC3: "I’m home" for an $state journey that is $whose gives exactly its expected outcome (SM-04)',
    ({ journey, expected }) => {
      expect(transition(journey, home())).toEqual(expected);
    },
  );

  test('LOST-03-AC3: the heartbeat’s own rows are unchanged: a LOST_CONTACT journey’s heartbeat is recorded and it stays LOST_CONTACT; the move back is the contact event’s', () => {
    expect(transition(named('LOST_CONTACT'), heartbeat())).toEqual(RECORDED_IN('LOST_CONTACT'));
    expect(
      transition(
        asCurrent({ id: JOURNEY, state: 'LOST_CONTACT' }),
        contact(LOST_CONTACT_AFTER_MS - 1),
      ),
    ).toEqual(BACK_IN_CONTACT);
  });

  test('LOST-03-AC3: for any situation and any event of the five kinds, any moments, an invalid one included, transition answers with a value of its event’s kind: never a throw, never undefined', () => {
    const anyEvent: fc.Arbitrary<JourneyEvent> = fc.oneof(
      fc.constant(start([RESPONDER])),
      anyHeartbeat,
      fc
        .record({ silentSince: anyMoment, now: anyMoment })
        .map(({ silentSince, now }) => silenceBetween(silentSince, now)),
      anyContact,
      anyHome,
    );

    fc.assert(
      fc.property(anyJourney, anyEvent, (journey, event) => {
        let outcome: unknown;
        expect(() => {
          outcome = transition(journey, event);
        }).not.toThrow();
        expect(outcome).toBeDefined();
        if (event.type === 'contact') {
          expect(outcome).toSatisfy(isOneOfTheContactOutcomes);
        }
        if (event.type === 'home') {
          expect(outcome).toSatisfy(isOneOfTheHomeOutcomes);
        }
      }),
    );
  });

  test('LOST-03-AC3: deciding about contact or "I’m home" changes neither the journey nor the event handed in', () => {
    const lost = { id: JOURNEY, state: 'LOST_CONTACT' as const };
    const event = contact(LOST_CONTACT_AFTER_MS - 1);
    const before = { since: event.silentSince.getTime(), now: event.now.getTime() };
    const journey = named('LOST_CONTACT');
    const homeEvent = home();
    const homeBefore = { journey: { ...journey }, event: { ...homeEvent } };

    transition(lost, event);
    transition(journey, homeEvent);

    expect(lost).toEqual({ id: JOURNEY, state: 'LOST_CONTACT' });
    expect([event.silentSince.getTime(), event.now.getTime()]).toEqual([before.since, before.now]);
    expect({ journey, event: homeEvent }).toEqual(homeBefore);
  });
});

describe('LOST-03 and REL-01: contact is back only when the silence is under five minutes, by the database clock', () => {
  test('LOST-03-AC2: a LOST_CONTACT journey whose silence, counted with the heartbeat just stored, is 4 min 59.999 s is back in contact; at exactly five minutes, or more, it is not', () => {
    const lost = asCurrent({ id: JOURNEY, state: 'LOST_CONTACT' });

    expect(transition(lost, contact(0))).toEqual(BACK_IN_CONTACT);
    expect(transition(lost, contact(LOST_CONTACT_AFTER_MS - 1))).toEqual(BACK_IN_CONTACT);
    expect(transition(lost, contact(LOST_CONTACT_AFTER_MS))).toEqual(UNCHANGED);
    expect(transition(lost, contact(LOST_CONTACT_AFTER_MS + 1))).toEqual(UNCHANGED);
    expect(transition(lost, contact(10 * HOUR))).toEqual(UNCHANGED);
  });

  test('LOST-03-AC2: for any moment the silence began and any moment it is asked about, a LOST_CONTACT journey is back exactly when the second is under five minutes after the first, a clock that ran backwards included', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: -HOUR, max: 3 * HOUR }),
          fc.constantFrom(LOST_CONTACT_AFTER_MS - 1, LOST_CONTACT_AFTER_MS),
        ),
        fc.integer({ min: 0, max: 400 * 24 * HOUR }),
        (silentForMs, offsetMs) => {
          const silentSince = new Date(SILENT_SINCE.getTime() + offsetMs);

          expect(
            transition(
              asCurrent({ id: JOURNEY, state: 'LOST_CONTACT' }),
              contact(silentForMs, silentSince),
            ),
          ).toEqual(silentForMs < LOST_CONTACT_AFTER_MS ? BACK_IN_CONTACT : UNCHANGED);
        },
      ),
    );
  });

  test('LOST-03-AC2: for any silence start and any now, contact moves a LOST_CONTACT journey back exactly when silence would not alert an ACTIVE one: the watchdog’s rule asked the other way, at the same threshold', () => {
    fc.assert(
      fc.property(fc.date({ noInvalidDate: true }), fc.date({ noInvalidDate: true }), (a, b) => {
        const back =
          transition(asCurrent({ id: JOURNEY, state: 'LOST_CONTACT' }), {
            type: 'contact',
            silentSince: a,
            now: b,
          }).type === 'back_in_contact';
        const alerted =
          transition(asCurrent({ id: JOURNEY, state: 'ACTIVE' }), silenceBetween(a, b)).type ===
          'lost_contact';

        expect(back).toBe(!alerted);
      }),
    );
  });

  test('LOST-03-AC2: a time that is not one moves nothing: an invalid silence start, an invalid now, or both, leave a LOST_CONTACT journey unchanged', () => {
    const invalid = new Date(Number.NaN);
    const valid = SILENT_SINCE;
    const lost = asCurrent({ id: JOURNEY, state: 'LOST_CONTACT' });

    for (const [silentSince, now] of [
      [invalid, valid],
      [valid, invalid],
      [invalid, invalid],
    ] as const) {
      expect(transition(lost, { type: 'contact', silentSince, now })).toEqual(UNCHANGED);
    }
  });

  test('LOST-03-AC2: only a LOST_CONTACT journey is ever brought back: ACTIVE, ENDED and no journey are unchanged, whatever the silence', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<Situation>('none', 'ACTIVE', 'ENDED'),
        fc.integer({ min: -HOUR, max: 48 * HOUR }),
        (situation, silentForMs) => {
          expect(transition(situationFor(situation), contact(silentForMs))).toEqual(UNCHANGED);
        },
      ),
    );
  });

  test('LOST-03-AC5: for any sequence of heartbeats and sweeps, step by step, a sweep loses the journey after five minutes of silence and contact under five minutes brings it back; the heartbeat rule alone never moves it', () => {
    // The testing strategy's L2 example, extended: a heartbeat is decided by
    // the heartbeat rule (recorded, the state unchanged), moves last contact
    // to its time, and is then asked about by the contact rule, as the store
    // asks it under the row lock.
    const step = fc.record({
      afterMs: fc.oneof(
        fc.integer({ min: 0, max: 7 * MINUTE }),
        fc.constantFrom(LOST_CONTACT_AFTER_MS - 1, LOST_CONTACT_AFTER_MS),
      ),
      kind: fc.constantFrom('heartbeat' as const, 'sweep' as const),
      // How long before it was stored the heartbeat was received.
      receivedBeforeMs: fc.oneof(
        fc.constant(0),
        fc.integer({ min: 0, max: 10 * MINUTE }),
        fc.constantFrom(LOST_CONTACT_AFTER_MS - 1, LOST_CONTACT_AFTER_MS),
      ),
    });

    fc.assert(
      fc.property(fc.array(step, { maxLength: 40 }), (steps) => {
        let elapsedMs = 0;
        let lastContactMs = 0;
        let state: Unended = 'ACTIVE';

        for (const { afterMs, kind, receivedBeforeMs } of steps) {
          elapsedMs += afterMs;
          const now = new Date(SILENT_SINCE.getTime() + elapsedMs);
          if (kind === 'heartbeat') {
            expect(transition(named(state), heartbeat())).toEqual(RECORDED_IN(state));
            lastContactMs = Math.max(lastContactMs, elapsedMs - receivedBeforeMs);
            const asked = transition(asCurrent({ id: JOURNEY, state }), {
              type: 'contact',
              silentSince: new Date(SILENT_SINCE.getTime() + lastContactMs),
              now,
            });
            const back =
              state === 'LOST_CONTACT' && elapsedMs - lastContactMs < LOST_CONTACT_AFTER_MS;
            expect(asked).toEqual(back ? BACK_IN_CONTACT : UNCHANGED);
            if (back) {
              state = 'ACTIVE';
            }
            continue;
          }
          const swept = transition(
            asCurrent({ id: JOURNEY, state }),
            silenceBetween(new Date(SILENT_SINCE.getTime() + lastContactMs), now),
          );
          const lost = state === 'ACTIVE' && elapsedMs - lastContactMs >= LOST_CONTACT_AFTER_MS;
          expect(swept).toEqual(lost ? LOST_CONTACT : UNCHANGED);
          if (lost) {
            state = 'LOST_CONTACT';
          }
          // After a sweep the state is exactly what the silence says.
          expect(state).toBe(
            elapsedMs - lastContactMs >= LOST_CONTACT_AFTER_MS ? 'LOST_CONTACT' : 'ACTIVE',
          );
        }
      }),
    );
  });
});

describe('SM-04, SM-07 and D-110: "I’m home", in the heartbeat rule’s order', () => {
  test('LOST-03-AC14: "I’m home" from the journey’s own device ends a LOST_CONTACT journey, HOME, and says its alert is to be resolved (SM-04)', () => {
    expect(transition(named('LOST_CONTACT'), home())).toEqual(ENDED_HOME(true));
  });

  test('LOST-03-AC15: "I’m home" from the journey’s own device ends an ACTIVE journey, HOME, with no alert to resolve (SM-04)', () => {
    expect(transition(named('ACTIVE'), home())).toEqual(ENDED_HOME(false));
  });

  test('LOST-03-AC16: an ENDED journey is ignored, JOURNEY_ENDED, from its own device and from another of the walker’s, before the device is looked at (SM-07)', () => {
    expect(transition(named('ENDED'), home())).toEqual(JOURNEY_ENDED);
    expect(transition(named('ENDED'), home(OTHER_DEVICE))).toEqual(JOURNEY_ENDED);
  });

  test.each(UNENDED)(
    'LOST-03-AC16: the walker’s %s journey, from another of their devices, is refused NOT_THE_JOURNEYS_DEVICE (D-101, D-110)',
    (state) => {
      expect(transition(named(state), home(OTHER_DEVICE))).toEqual(NOT_THE_JOURNEYS_DEVICE);
    },
  );

  test.each(JOURNEY_STATES)(
    'LOST-03-AC16: another walker’s %s journey, or none, is JOURNEY_NOT_FOUND, one answer for both (SEC-07)',
    (state) => {
      expect(transition(named(state, { walkerId: OTHER_WALKER }), home())).toEqual(
        JOURNEY_NOT_FOUND,
      );
      expect(transition(null, home())).toEqual(JOURNEY_NOT_FOUND);
    },
  );

  test('LOST-03-AC16: for any situation and any "I’m home", the outcome is the rule’s, in its order', () => {
    fc.assert(
      fc.property(anyJourney, anyHome, (journey, event) => {
        expect(transition(journey, event)).toEqual(expectedHomeOutcome(journey, event));
      }),
    );
  });
});

describe('LOST-03: the lists that are the one source for the table, the type and the database', () => {
  test('LOST-03-AC3: MESSAGE_KINDS is exactly LOST_CONTACT, BACK_IN_CONTACT and HOME, in order', () => {
    expect([...MESSAGE_KINDS]).toEqual(['LOST_CONTACT', 'BACK_IN_CONTACT', 'HOME']);
  });

  test('LOST-03-AC3: ALERT_RESOLUTIONS is exactly BACK_IN_CONTACT and HOME, each a message kind: a stand-down’s kind is its resolution’s own name (also held at typecheck)', () => {
    // L1: assignable only while every resolution is a message kind.
    const asKinds: readonly MessageKind[] = ALERT_RESOLUTIONS;
    const resolution: AlertResolution = 'HOME';

    expect([...ALERT_RESOLUTIONS]).toEqual(['BACK_IN_CONTACT', 'HOME']);
    expect(asKinds.filter((kind) => !(MESSAGE_KINDS as readonly string[]).includes(kind))).toEqual(
      [],
    );
    expect(MESSAGE_KINDS).toContain(resolution);
  });

  test('LOST-03-AC3: JOURNEY_END_REASONS is exactly HOME', () => {
    const reason: JourneyEndReason = 'HOME';

    expect([...JOURNEY_END_REASONS]).toEqual([reason]);
  });
});
