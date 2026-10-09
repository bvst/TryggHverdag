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
//      ACTIVE (SM-03), and LOST_CONTACT stays LOST_CONTACT under this rule;
//      moving it back is the contact rule's (LOST-03, D-112), asked by the
//      store under the row's lock once the heartbeat is stored.
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
//
// SM-10 adds the sixth event, remove (its spec's approach item 2), and the
// alert rule's third, acknowledger_removed (approach item 4), with the kind
// NO_RESPONDER and three lists (approach items 4, 6 and 7). The removal's
// rule, in its order:
//   1. no journey → refused, JOURNEY_NOT_FOUND;
//   2. ENDED → ignored, JOURNEY_ENDED (SM-07);
//   3. the responder not among the journey's → unchanged, NOT_A_RESPONDER,
//      the walker included, IDs compared exactly;
//   4. otherwise → removed, the state as it was, saying whether no responder
//      is left (SM-02's last responder).
// The reset's, in its order: no unresolved alert, RESOLVED, or someone other
// than the removed responder recorded (nobody included) → unchanged;
// otherwise → reset, OPEN, whatever the state was.
import {
  JOURNEY_MESSAGE_KINDS as KIT_JOURNEY_MESSAGE_KINDS,
  MESSAGE_KINDS as KIT_MESSAGE_KINDS,
  PUSH_KINDS as KIT_PUSH_KINDS,
  SMS_KINDS as KIT_SMS_KINDS,
  WITHDRAWN_WHEN_ACKNOWLEDGED as KIT_WITHDRAWN_WHEN_ACKNOWLEDGED,
  WITHDRAWN_WHEN_OPENED as KIT_WITHDRAWN_WHEN_OPENED,
  WITHDRAWN_WHEN_REMOVED as KIT_WITHDRAWN_WHEN_REMOVED,
  WITHDRAWN_WHEN_RESET as KIT_WITHDRAWN_WHEN_RESET,
  WITHDRAWN_WHEN_RESOLVED as KIT_WITHDRAWN_WHEN_RESOLVED,
  fc,
  syntheticPosition,
  syntheticUuid,
} from '@trygghverdag/test-kit';
import { describe, expect, test } from 'vitest';
import {
  ALERT_EVENTS,
  ALERT_RESOLUTIONS,
  ALERT_STATES,
  ESCALATE_AFTER_MS,
  JOURNEY_END_REASONS,
  JOURNEY_EVENTS,
  JOURNEY_MESSAGE_KINDS,
  JOURNEY_STATES,
  LOST_CONTACT_AFTER_MS,
  MESSAGE_KINDS,
  PUSH_KINDS,
  SMS_KINDS,
  WITHDRAWN_WHEN_ACKNOWLEDGED,
  WITHDRAWN_WHEN_REMOVED,
  WITHDRAWN_WHEN_RESET,
  WITHDRAWN_WHEN_RESOLVED,
  alertTransition,
  transition,
  type AcknowledgeEvent,
  type AcknowledgeRefusal,
  type AcknowledgerRemovedEvent,
  type AlertForAcknowledgement,
  type AlertForEscalation,
  type AlertForReset,
  type AlertResolution,
  type AlertState,
  type EscalateEvent,
  type EscalateOutcome,
  type ContactEvent,
  type HeartbeatEvent,
  type HomeEvent,
  type JourneyEndReason,
  type JourneyEventType,
  type JourneyForHeartbeat,
  type JourneyForRemoval,
  type JourneyState,
  type MessageKind,
  type RemoveEvent,
  type RemoveOutcome,
  type ResetOutcome,
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

/** SM-10: the removal of this responder, by its ID as given. */
function remove(responderId: string): RemoveEvent {
  return { type: 'remove', responderId };
}

/** SM-10: the removal's four outcomes, as the spec names them (approach item 2). */
const REMOVED_FROM = (state: Unended, lastResponder: boolean): RemoveOutcome => ({
  type: 'removed',
  state,
  lastResponder,
});
const NOT_A_RESPONDER: RemoveOutcome = { type: 'unchanged', reason: 'NOT_A_RESPONDER' };
const REMOVAL_IGNORED: RemoveOutcome = { type: 'ignored', reason: 'JOURNEY_ENDED' };
const REMOVAL_REFUSED: RemoveOutcome = { type: 'refused', reason: 'JOURNEY_NOT_FOUND' };

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
  // SM-10: the removal of RESPONDER, named as one of the journey's two
  // responders, so the situation decides. As the only responder, and not
  // named, are REMOVE_ROWS, below.
  remove: () => remove(RESPONDER),
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
    // Contact while LOST_CONTACT is recorded, and the state stays under the
    // heartbeat rule: the move back to ACTIVE, which resolves the alert and
    // stands the responders down, is the contact rule's (LOST-03, D-112),
    // in the contact rows below, asked by the store once the heartbeat is
    // stored.
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
  // SM-10 (RG-03, the spec's "Existing assertions that change by design":
  // TRANSITIONS is typed over JOURNEY_EVENTS, so it gains the removal's
  // rows): RESPONDER, one of two, removed from each situation. No journey is
  // not found; an ENDED one is ignored (SM-07); an unended one keeps its
  // state, and one responder is left. Every row above keeps its outcome.
  remove: {
    none: { outcome: REMOVAL_REFUSED },
    ACTIVE: { outcome: REMOVED_FROM('ACTIVE', false) },
    LOST_CONTACT: { outcome: REMOVED_FROM('LOST_CONTACT', false) },
    ENDED: { outcome: REMOVAL_IGNORED },
  },
} satisfies Record<JourneyEventType, Record<Situation, Row>>;

/**
 * SM-10-AC16: the removal in every situation, the responder named as the only
 * one, as one of several, and not named at all (the walker's own ID, which is
 * never a responder's). Typed over the states, so a state added later needs
 * its rows here too.
 */
const REMOVE_ROWS_BY_STATE = {
  ACTIVE: {
    theOnly: REMOVED_FROM('ACTIVE', true),
    oneOfSeveral: REMOVED_FROM('ACTIVE', false),
    notNamed: NOT_A_RESPONDER,
  },
  LOST_CONTACT: {
    theOnly: REMOVED_FROM('LOST_CONTACT', true),
    oneOfSeveral: REMOVED_FROM('LOST_CONTACT', false),
    notNamed: NOT_A_RESPONDER,
  },
  ENDED: { theOnly: REMOVAL_IGNORED, oneOfSeveral: REMOVAL_IGNORED, notNamed: REMOVAL_IGNORED },
} satisfies Record<
  JourneyState,
  { theOnly: RemoveOutcome; oneOfSeveral: RemoveOutcome; notNamed: RemoveOutcome }
>;

/** The journey a removal row is asked about, by how the responder stands on it. */
function journeyForRemoval(
  state: JourneyState,
  named: 'theOnly' | 'oneOfSeveral' | 'notNamed',
): JourneyForRemoval {
  return {
    id: JOURNEY,
    state,
    responderIds:
      named === 'theOnly'
        ? [RESPONDER]
        : named === 'oneOfSeveral'
          ? [OTHER_RESPONDER, RESPONDER]
          : [OTHER_RESPONDER],
  };
}

const REMOVE_ROWS = [
  { situation: 'no journey', journey: null, expected: REMOVAL_REFUSED },
  ...Object.entries(REMOVE_ROWS_BY_STATE).flatMap(([state, rows]) =>
    (['theOnly', 'oneOfSeveral', 'notNamed'] as const).map((named) => ({
      situation: `${state}, the responder ${
        named === 'theOnly'
          ? 'the only one'
          : named === 'oneOfSeveral'
            ? 'one of several'
            : 'not named'
      }`,
      journey: journeyForRemoval(state as JourneyState, named),
      expected: rows[named],
    })),
  ),
];

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
  remove: 'SM-10-AC16',
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
    case 'remove':
      // SM-10: the removal reads the journey and its responders, RESPONDER
      // one of the two.
      return transition(
        situation === 'none' ? null : journeyForRemoval(situation as JourneyState, 'oneOfSeveral'),
        EVENT_FOR.remove(),
      );
  }
}

describe('AR-04: the journey state machine is one module, total over its own lists', () => {
  test('SM-01-AC14: the states are exactly ACTIVE, LOST_CONTACT and ENDED, and the events exactly start, heartbeat, silence, contact, home and remove', () => {
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
    //
    // RG-03 (SM-10, the spec's "Existing assertions that change by design",
    // line 456): remove joins by design, the removal of a responder
    // (SM-10-AC16, its spec's approach item 2), last; the title gains it. The
    // states do not change; the list is still pinned exactly, in order.
    expect([...JOURNEY_STATES].sort()).toEqual(['ACTIVE', 'ENDED', 'LOST_CONTACT']);
    expect([...JOURNEY_EVENTS]).toEqual([
      'start',
      'heartbeat',
      'silence',
      'contact',
      'home',
      'remove',
    ]);
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

  // RG-03 (SM-10, the spec's "Existing assertions that change by design",
  // line 488): the four removal pairs join by design (SM-10-AC16: "the
  // journey's transition table holds an expectation for remove in every
  // situation"), and the title with them. Every pair that was here still is,
  // with the same outcome.
  test('SM-01-AC14: the pairs with an outcome are exactly none, ACTIVE, LOST_CONTACT and ENDED, each with start, with heartbeat, with silence, with contact, with home and with remove', () => {
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
        'ACTIVE × remove',
        'ENDED × remove',
        'LOST_CONTACT × remove',
        'none × remove',
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
  test('LOST-01-AC17: JOURNEY_EVENTS is exactly start and heartbeat, and then silence, contact, home and remove', () => {
    // RG-03 (LOST-02): silence is added after the heartbeat by design
    // (LOST-02-AC6). Start and heartbeat keep their places; the pin is exact.
    //
    // RG-03 (LOST-03): contact and home are added after silence by design
    // (LOST-03-AC3). Start and heartbeat keep their places; the pin is exact.
    //
    // RG-03 (SM-10, the spec's "Existing assertions that change by design",
    // line 867): remove is added after home by design (SM-10-AC16), and the
    // title with it. Start and heartbeat keep their places; the pin is exact.
    expect([...JOURNEY_EVENTS]).toEqual([
      'start',
      'heartbeat',
      'silence',
      'contact',
      'home',
      'remove',
    ]);
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
  test('LOST-02-AC6: JOURNEY_EVENTS is exactly start, heartbeat, silence, contact, home and remove, and ALERT_STATES exactly OPEN, ESCALATED, ACKNOWLEDGED and RESOLVED, in order (D-033)', () => {
    // RG-03 (LOST-03, the spec's "Existing assertions that change by
    // design"): JOURNEY_EVENTS gains contact and home, after silence. The
    // alert states do not change. Both lists are still pinned exactly.
    //
    // RG-03 (SM-10, the spec's "Existing assertions that change by design",
    // line 1135): JOURNEY_EVENTS gains remove, after home, and the title with
    // it (SM-10-AC16). The alert states do not change. Still exact.
    expect([...JOURNEY_EVENTS]).toEqual([
      'start',
      'heartbeat',
      'silence',
      'contact',
      'home',
      'remove',
    ]);
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

  // RG-03 (LOST-03 review loop 1, the spec's item 10): the title only. It
  // said moving back was "the back-in-contact task’s", which is now the
  // contact rule's. No assertion changes.
  test('LOST-02-AC5: a heartbeat for a journey in LOST_CONTACT is recorded and leaves it LOST_CONTACT under the heartbeat rule, and the next silence alerts it no more; moving it back is the contact rule’s', () => {
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
  // RG-03 (SM-10, the spec's "Existing assertions that change by design",
  // line 1423): JOURNEY_EVENTS gains remove, after home, and the title with
  // it (SM-10-AC16). Still exact, in order.
  test('LOST-03-AC3: JOURNEY_EVENTS is exactly start, heartbeat, silence, contact, home and remove, in order', () => {
    expect([...JOURNEY_EVENTS]).toEqual([
      'start',
      'heartbeat',
      'silence',
      'contact',
      'home',
      'remove',
    ]);
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
  // RG-03 (LOST-06, the spec's "Existing assertions that change by design"):
  // this was "…exactly LOST_CONTACT, BACK_IN_CONTACT and HOME, in order". The
  // list gains ACKNOWLEDGED, the "someone is on it" notice (D-113), last, and
  // the title with it. Still exact, in order; LOST-06-AC13 below pins it too.
  // RG-03 (LOST-07, the spec's "Existing assertions that change by design",
  // line 1687): the list gains LOST_CONTACT_SMS, the escalation SMS (D-019),
  // last, and the title with it. Still exact, in order.
  // RG-03 (SM-10, the spec's "Existing assertions that change by design",
  // line 1700): the list gains NO_RESPONDER, the walker's warning (SM-02,
  // D-087), last, and the title with it. Still exact, in order.
  test('LOST-03-AC3: MESSAGE_KINDS is exactly LOST_CONTACT, BACK_IN_CONTACT, HOME, ACKNOWLEDGED, LOST_CONTACT_SMS and NO_RESPONDER, in order', () => {
    expect([...MESSAGE_KINDS]).toEqual([
      'LOST_CONTACT',
      'BACK_IN_CONTACT',
      'HOME',
      'ACKNOWLEDGED',
      'LOST_CONTACT_SMS',
      'NO_RESPONDER',
    ]);
  });

  // Review loop 1 (the spec's item 11a): the test kit cannot import the
  // server, so its own list (fake-push.ts) is held to the domain's here.
  test('LOST-03-AC3: the test kit’s MESSAGE_KINDS equals the domain’s, in order', () => {
    expect([...KIT_MESSAGE_KINDS]).toEqual([...MESSAGE_KINDS]);
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

// ===========================================================================
// LOST-06: "I'm on it", the alert's own rule (its spec's approach item 2).
//
// An acknowledgement's situation is an alert's, not a journey's, so it has an
// event list of its own, ALERT_EVENTS, and a rule of its own,
// alertTransition; JOURNEY_EVENTS and the journey's table are unchanged. The
// rule, in its order, which is part of the rule:
//   1. no alert, or a sender who is not a responder of its journey → refused,
//      ALERT_NOT_FOUND, one answer for both (SEC-07);
//   2. RESOLVED → ignored, ALERT_RESOLVED;
//   3. the sender already recorded → unchanged, ALREADY_YOURS;
//   4. someone else recorded → refused, ALREADY_ACKNOWLEDGED;
//   5. otherwise → acknowledged, ACKNOWLEDGED.
// IDs are compared exactly. The table below holds every pair the lists
// create, so a state or an event added later fails here, naming the pair.
// ===========================================================================

/** The alert rule's outcomes, as the spec names them. */
type AlertOutcome =
  | { type: 'acknowledged'; state: 'ACKNOWLEDGED' }
  | { type: 'unchanged'; reason: 'ALREADY_YOURS' }
  | AcknowledgeRefusal;

const ACKNOWLEDGED: AlertOutcome = { type: 'acknowledged', state: 'ACKNOWLEDGED' };
const ALREADY_YOURS: AlertOutcome = { type: 'unchanged', reason: 'ALREADY_YOURS' };
const ALREADY_ACKNOWLEDGED: AlertOutcome = { type: 'refused', reason: 'ALREADY_ACKNOWLEDGED' };
const ALERT_NOT_FOUND: AlertOutcome = { type: 'refused', reason: 'ALERT_NOT_FOUND' };
const ALERT_RESOLVED: AlertOutcome = { type: 'ignored', reason: 'ALERT_RESOLVED' };

type AlertEventType = (typeof ALERT_EVENTS)[number];

/** Who is recorded on the alert, seen from the sender. */
const RECORDED = ['nobody on it', 'the sender on it', 'another responder on it'] as const;
/** Whether the sender is a responder of the alert's journey. */
const SENDERS = ['sent by a responder', 'sent by a non-responder'] as const;

/** An alert's situation: none, or its state, who is on it, and who sends. */
type AlertSituation =
  'no alert' | `${AlertState}; ${(typeof RECORDED)[number]}; ${(typeof SENDERS)[number]}`;

const SENDER = syntheticUuid();
const ON_IT = syntheticUuid();
const ALERT = syntheticUuid();

/**
 * LOST-07: the escalation's situations (its spec's AC13): no alert, or each
 * of the four states, with nobody and someone recorded, with and without an
 * escalation time, under and at two minutes since it opened.
 */
const ESCALATION_RECORDED = ['nobody recorded', 'someone recorded'] as const;
const ESCALATION_TIMES = ['no escalation time', 'an escalation time'] as const;
const AGES = ['under two minutes', 'two minutes'] as const;
type EscalationSituation =
  | 'no alert'
  | `${AlertState}; ${(typeof ESCALATION_RECORDED)[number]}; ${(typeof ESCALATION_TIMES)[number]}; ${(typeof AGES)[number]}`;

/** The escalation's two outcomes, as the spec names them. */
const ESCALATED: EscalateOutcome = { type: 'escalated', state: 'ESCALATED' };
const NOT_ESCALATED: EscalateOutcome = { type: 'unchanged' };

/** Two minutes (D-019), written out, so a wrong ESCALATE_AFTER_MS fails here too. */
const TWO_MINUTES = 120_000;

/** When the alert opened, in every escalation situation. */
const OPENED_AT = new Date('2026-10-01T21:35:00.000Z');

/**
 * SM-10: the reset's situations (its spec's AC16): no alert, or each of the
 * four states with nobody, the removed responder, or another responder
 * recorded on it.
 */
const RESET_RECORDED = [
  'nobody recorded',
  'the removed responder recorded',
  'another responder recorded',
] as const;
type ResetSituation = 'no alert' | `${AlertState}; ${(typeof RESET_RECORDED)[number]}`;

/** The reset's two outcomes, as the spec names them (approach item 4). */
const RESET: ResetOutcome = { type: 'reset', state: 'OPEN' };
const NOT_RESET: ResetOutcome = { type: 'unchanged' };

/** The responder removed, in every reset situation. */
const REMOVED = syntheticUuid();

/** Each alert event's situations and outcomes: the table is typed one event at a time. */
interface AlertTable {
  acknowledge: Record<AlertSituation, AlertOutcome>;
  escalate: Record<EscalationSituation, EscalateOutcome>;
  acknowledger_removed: Record<ResetSituation, ResetOutcome>;
}

/**
 * Every (alert situation, event) pair and its outcome, written out. Typed over
 * the lists, so a state or an event added later without rows is a type
 * error, and the run-time check below names the pair.
 */
const ALERT_TRANSITIONS = {
  acknowledge: {
    'no alert': ALERT_NOT_FOUND,
    'OPEN; nobody on it; sent by a responder': ACKNOWLEDGED,
    'OPEN; the sender on it; sent by a responder': ALREADY_YOURS,
    'OPEN; another responder on it; sent by a responder': ALREADY_ACKNOWLEDGED,
    'OPEN; nobody on it; sent by a non-responder': ALERT_NOT_FOUND,
    'OPEN; the sender on it; sent by a non-responder': ALERT_NOT_FOUND,
    'OPEN; another responder on it; sent by a non-responder': ALERT_NOT_FOUND,
    // ESCALATED (escalation to SMS writes it; put in here directly) is
    // acknowledged as OPEN is: the SMS has gone, and someone is now on it.
    'ESCALATED; nobody on it; sent by a responder': ACKNOWLEDGED,
    'ESCALATED; the sender on it; sent by a responder': ALREADY_YOURS,
    'ESCALATED; another responder on it; sent by a responder': ALREADY_ACKNOWLEDGED,
    'ESCALATED; nobody on it; sent by a non-responder': ALERT_NOT_FOUND,
    'ESCALATED; the sender on it; sent by a non-responder': ALERT_NOT_FOUND,
    'ESCALATED; another responder on it; sent by a non-responder': ALERT_NOT_FOUND,
    // ACKNOWLEDGED with nobody recorded, a state the code never makes, is met
    // in the safe direction: someone can still take it (reading 3).
    'ACKNOWLEDGED; nobody on it; sent by a responder': ACKNOWLEDGED,
    'ACKNOWLEDGED; the sender on it; sent by a responder': ALREADY_YOURS,
    'ACKNOWLEDGED; another responder on it; sent by a responder': ALREADY_ACKNOWLEDGED,
    'ACKNOWLEDGED; nobody on it; sent by a non-responder': ALERT_NOT_FOUND,
    'ACKNOWLEDGED; the sender on it; sent by a non-responder': ALERT_NOT_FOUND,
    'ACKNOWLEDGED; another responder on it; sent by a non-responder': ALERT_NOT_FOUND,
    // RESOLVED is final: ignored, whoever is on it, before anything else but
    // whether the sender follows the journey at all.
    'RESOLVED; nobody on it; sent by a responder': ALERT_RESOLVED,
    'RESOLVED; the sender on it; sent by a responder': ALERT_RESOLVED,
    'RESOLVED; another responder on it; sent by a responder': ALERT_RESOLVED,
    'RESOLVED; nobody on it; sent by a non-responder': ALERT_NOT_FOUND,
    'RESOLVED; the sender on it; sent by a non-responder': ALERT_NOT_FOUND,
    'RESOLVED; another responder on it; sent by a non-responder': ALERT_NOT_FOUND,
  },
  // LOST-07-AC13: the escalation's rows (its spec's approach item 2), in the
  // rule's order: no alert, RESOLVED, acknowledged in D-114's sense (state
  // ACKNOWLEDGED and someone recorded), already escalated, and then two
  // minutes or more since it opened. Only the five rows that reach the last
  // step at two minutes escalate; a missing half of an acknowledgement does.
  escalate: {
    'no alert': NOT_ESCALATED,
    'OPEN; nobody recorded; no escalation time; under two minutes': NOT_ESCALATED,
    'OPEN; nobody recorded; no escalation time; two minutes': ESCALATED,
    'OPEN; nobody recorded; an escalation time; under two minutes': NOT_ESCALATED,
    'OPEN; nobody recorded; an escalation time; two minutes': NOT_ESCALATED,
    // OPEN with someone recorded: a half-done reset, escalated.
    'OPEN; someone recorded; no escalation time; under two minutes': NOT_ESCALATED,
    'OPEN; someone recorded; no escalation time; two minutes': ESCALATED,
    'OPEN; someone recorded; an escalation time; under two minutes': NOT_ESCALATED,
    'OPEN; someone recorded; an escalation time; two minutes': NOT_ESCALATED,
    // ESCALATED with no escalation time: put in directly, as from before
    // migration 0006, and escalated.
    'ESCALATED; nobody recorded; no escalation time; under two minutes': NOT_ESCALATED,
    'ESCALATED; nobody recorded; no escalation time; two minutes': ESCALATED,
    'ESCALATED; nobody recorded; an escalation time; under two minutes': NOT_ESCALATED,
    'ESCALATED; nobody recorded; an escalation time; two minutes': NOT_ESCALATED,
    'ESCALATED; someone recorded; no escalation time; under two minutes': NOT_ESCALATED,
    'ESCALATED; someone recorded; no escalation time; two minutes': ESCALATED,
    'ESCALATED; someone recorded; an escalation time; under two minutes': NOT_ESCALATED,
    'ESCALATED; someone recorded; an escalation time; two minutes': NOT_ESCALATED,
    // ACKNOWLEDGED with nobody recorded, a state the code never makes: the
    // missing half sends the SMS (D-114).
    'ACKNOWLEDGED; nobody recorded; no escalation time; under two minutes': NOT_ESCALATED,
    'ACKNOWLEDGED; nobody recorded; no escalation time; two minutes': ESCALATED,
    'ACKNOWLEDGED; nobody recorded; an escalation time; under two minutes': NOT_ESCALATED,
    'ACKNOWLEDGED; nobody recorded; an escalation time; two minutes': NOT_ESCALATED,
    // ACKNOWLEDGED with someone recorded: someone is on it. Never escalated.
    'ACKNOWLEDGED; someone recorded; no escalation time; under two minutes': NOT_ESCALATED,
    'ACKNOWLEDGED; someone recorded; no escalation time; two minutes': NOT_ESCALATED,
    'ACKNOWLEDGED; someone recorded; an escalation time; under two minutes': NOT_ESCALATED,
    'ACKNOWLEDGED; someone recorded; an escalation time; two minutes': NOT_ESCALATED,
    // RESOLVED is over, whatever else it holds.
    'RESOLVED; nobody recorded; no escalation time; under two minutes': NOT_ESCALATED,
    'RESOLVED; nobody recorded; no escalation time; two minutes': NOT_ESCALATED,
    'RESOLVED; nobody recorded; an escalation time; under two minutes': NOT_ESCALATED,
    'RESOLVED; nobody recorded; an escalation time; two minutes': NOT_ESCALATED,
    'RESOLVED; someone recorded; no escalation time; under two minutes': NOT_ESCALATED,
    'RESOLVED; someone recorded; no escalation time; two minutes': NOT_ESCALATED,
    'RESOLVED; someone recorded; an escalation time; under two minutes': NOT_ESCALATED,
    'RESOLVED; someone recorded; an escalation time; two minutes': NOT_ESCALATED,
  },
  // RG-03 (LOST-07, the spec's "Existing assertions that change by design",
  // lines 1765 to 1799): the table is typed over ALERT_EVENTS, so it gains
  // the escalate rows. Each event has situations of its own, so the type is
  // now one entry per event, each typed over its own situations: an event
  // added to ALERT_EVENTS without an entry here is still a type error. The
  // acknowledgement's rows and their outcomes do not change.
  //
  // RG-03 (SM-10, the spec's "Existing assertions that change by design",
  // line 2129: ALERT_TRANSITIONS is typed over ALERT_EVENTS, so it gains the
  // reset's rows): SM-10-AC16, the reset (its spec's approach item 4), in
  // the rule's order: no alert, RESOLVED, someone other than the removed
  // responder recorded (nobody included), and then reset, OPEN, whatever the
  // state. The acknowledgement's and the escalation's rows do not change.
  acknowledger_removed: {
    'no alert': NOT_RESET,
    'OPEN; nobody recorded': NOT_RESET,
    // A half-done record, the removed responder on an OPEN alert, put in
    // directly: reset all the same, in the safe direction (reading 4).
    'OPEN; the removed responder recorded': RESET,
    'OPEN; another responder recorded': NOT_RESET,
    'ESCALATED; nobody recorded': NOT_RESET,
    'ESCALATED; the removed responder recorded': RESET,
    'ESCALATED; another responder recorded': NOT_RESET,
    // ACKNOWLEDGED with nobody recorded, a state the code never makes: there
    // is no acknowledger to remove, and the escalation already reads it as
    // nobody on it (D-114).
    'ACKNOWLEDGED; nobody recorded': NOT_RESET,
    // The rule's own case: the acknowledger removed, the alert back to OPEN.
    'ACKNOWLEDGED; the removed responder recorded': RESET,
    'ACKNOWLEDGED; another responder recorded': NOT_RESET,
    // RESOLVED is over: who helped stays on record.
    'RESOLVED; nobody recorded': NOT_RESET,
    'RESOLVED; the removed responder recorded': NOT_RESET,
    'RESOLVED; another responder recorded': NOT_RESET,
  },
} satisfies { [E in AlertEventType]: AlertTable[E] };

/** SM-10: the alert a reset situation names: its state and who is recorded on it. */
function resetFor(situation: string): AlertForReset | null {
  if (situation === 'no alert') {
    return null;
  }
  const [state, recorded] = situation.split('; ');
  return {
    id: ALERT,
    state: state as AlertState,
    acknowledgedBy:
      recorded === 'the removed responder recorded'
        ? REMOVED
        : recorded === 'another responder recorded'
          ? ON_IT
          : null,
  };
}

/** SM-10: the removal of this responder, as the alert rule hears it. */
function acknowledgerRemoved(responderId: string): AcknowledgerRemovedEvent {
  return { type: 'acknowledger_removed', responderId };
}

/** SM-10-AC16: the reset's rows. */
const RESET_ROWS = Object.entries(ALERT_TRANSITIONS.acknowledger_removed).map(
  ([situation, expected]: [string, ResetOutcome]) => ({
    event: 'acknowledger_removed',
    situation,
    expected,
  }),
);

/** The alert a situation names: its state, who is on it, and its journey's responders. */
function alertFor(situation: string): AlertForAcknowledgement | null {
  if (situation === 'no alert') {
    return null;
  }
  const [state, recorded, sender] = situation.split('; ');
  return {
    id: ALERT,
    state: state as AlertState,
    acknowledgedBy:
      recorded === 'the sender on it'
        ? SENDER
        : recorded === 'another responder on it'
          ? ON_IT
          : null,
    responderIds: sender === 'sent by a responder' ? [ON_IT, SENDER] : [ON_IT],
  };
}

function acknowledgeBy(responderId: string): AcknowledgeEvent {
  return { type: 'acknowledge', responderId };
}

/**
 * Every situation an event of the alert lists meets, read at run time. An
 * event listed later, with no situations written here, gets one pair that
 * names it, and fails the check below until its rows are written.
 */
function alertSituationsOf(event: string): string[] {
  if (event === 'acknowledge') {
    return [
      'no alert',
      ...ALERT_STATES.flatMap((state) =>
        RECORDED.flatMap((recorded) => SENDERS.map((sender) => `${state}; ${recorded}; ${sender}`)),
      ),
    ];
  }
  if (event === 'escalate') {
    return [
      'no alert',
      ...ALERT_STATES.flatMap((state) =>
        ESCALATION_RECORDED.flatMap((recorded) =>
          ESCALATION_TIMES.flatMap((time) =>
            AGES.map((age) => `${state}; ${recorded}; ${time}; ${age}`),
          ),
        ),
      ),
    ];
  }
  // SM-10 (RG-03, as the table above): the reset's situations.
  if (event === 'acknowledger_removed') {
    return [
      'no alert',
      ...ALERT_STATES.flatMap((state) => RESET_RECORDED.map((recorded) => `${state}; ${recorded}`)),
    ];
  }
  return [`(no situations written here for the event ${event})`];
}

/** Every pair the alert lists create, read at run time. */
function alertPairsTheModuleCreates(): string[] {
  // RG-03 (LOST-07, the spec's "Existing assertions that change by design",
  // the table's rows): each event now has situations of its own, so the
  // pairs are built per event. The acknowledgement's are as they were.
  return [...ALERT_EVENTS].flatMap((event) =>
    alertSituationsOf(event).map((situation) => `${situation} × ${event}`),
  );
}

// RG-03 (LOST-07): the acknowledgement's rows, as before. They were every
// row of the table, when the table held one event; the escalation's rows,
// which ask a different event with a different situation, are
// ESCALATION_ROWS below.
const ALERT_ROWS = Object.entries(ALERT_TRANSITIONS.acknowledge).map(
  ([situation, expected]: [string, AlertOutcome]) => ({
    event: 'acknowledge',
    situation,
    expected,
  }),
);

/** LOST-07-AC13: the escalation's rows. */
const ESCALATION_ROWS = Object.entries(ALERT_TRANSITIONS.escalate).map(
  ([situation, expected]: [string, EscalateOutcome]) => ({
    event: 'escalate',
    situation,
    expected,
  }),
);

/** The alert an escalation situation names: its state, who is recorded, and its escalation time. */
function escalationFor(situation: string): AlertForEscalation | null {
  if (situation === 'no alert') {
    return null;
  }
  const [state, recorded, time] = situation.split('; ');
  return {
    id: ALERT,
    state: state as AlertState,
    acknowledgedBy: recorded === 'someone recorded' ? ON_IT : null,
    smsRaisedAt:
      time === 'an escalation time' ? new Date(OPENED_AT.getTime() + TWO_MINUTES + 5_000) : null,
  };
}

/** The escalation a situation is asked with: the alert's opening, and now, under or at two minutes after it. */
function escalateIn(situation: string): EscalateEvent {
  const ageMs = situation.endsWith('under two minutes') ? TWO_MINUTES - 1 : TWO_MINUTES;
  return { type: 'escalate', openedAt: OPENED_AT, now: new Date(OPENED_AT.getTime() + ageMs) };
}

/** The escalation rule, in its order, as the spec writes it (approach item 2). */
function expectedEscalation(
  alert: AlertForEscalation | null,
  { openedAt, now }: EscalateEvent,
): EscalateOutcome {
  if (alert === null) {
    return NOT_ESCALATED;
  }
  if (alert.state === 'RESOLVED') {
    return NOT_ESCALATED;
  }
  if (alert.state === 'ACKNOWLEDGED' && alert.acknowledgedBy !== null) {
    return NOT_ESCALATED;
  }
  if (alert.smsRaisedAt !== null) {
    return NOT_ESCALATED;
  }
  return now.getTime() - openedAt.getTime() >= TWO_MINUTES ? ESCALATED : NOT_ESCALATED;
}

/**
 * Any alert, or none, and any two moments, a moment that is not one
 * included: around the two minutes and far from them.
 */
const anyEscalation = fc.record({
  alert: fc.option(
    fc.record({
      id: fc.uuid(),
      state: fc.constantFrom(...ALERT_STATES),
      acknowledgedBy: fc.option(fc.uuid(), { nil: null }),
      smsRaisedAt: fc.option(fc.date({ noInvalidDate: false }), { nil: null }),
    }),
    { nil: null },
  ),
  openedAt: fc.date({ noInvalidDate: false }),
  ageMs: fc.oneof(
    fc.integer({ min: -TWO_MINUTES, max: 3 * TWO_MINUTES }),
    fc.constantFrom(TWO_MINUTES - 1, TWO_MINUTES, TWO_MINUTES + 1),
  ),
  nowIsAMoment: fc.boolean(),
});

/** The escalation an arbitrary draws: now `ageMs` after the opening, or not a moment at all. */
function escalationDrawn({
  openedAt,
  ageMs,
  nowIsAMoment,
}: {
  openedAt: Date;
  ageMs: number;
  nowIsAMoment: boolean;
}): EscalateEvent {
  return {
    type: 'escalate',
    openedAt,
    now: nowIsAMoment ? new Date(openedAt.getTime() + ageMs) : new Date(Number.NaN),
  };
}

/** The rule, in its order, as the spec writes it. */
function expectedAlertOutcome(
  alert: AlertForAcknowledgement | null,
  { responderId }: AcknowledgeEvent,
): AlertOutcome {
  if (alert?.responderIds.includes(responderId) !== true) {
    return ALERT_NOT_FOUND;
  }
  if (alert.state === 'RESOLVED') {
    return ALERT_RESOLVED;
  }
  if (alert.acknowledgedBy === responderId) {
    return ALREADY_YOURS;
  }
  if (alert.acknowledgedBy !== null) {
    return ALREADY_ACKNOWLEDGED;
  }
  return ACKNOWLEDGED;
}

/** The five outcomes, with exactly their fields. */
function isOneOfTheAlertOutcomes(value: unknown): boolean {
  return [ACKNOWLEDGED, ALREADY_YOURS, ALREADY_ACKNOWLEDGED, ALERT_NOT_FOUND, ALERT_RESOLVED].some(
    (outcome) => JSON.stringify(outcome) === JSON.stringify(value),
  );
}

/**
 * Any alert, or none, and any sender: IDs from a small pool, so a sender is
 * often a responder and often the one recorded, in either case, since the
 * rule compares IDs exactly.
 */
const anyAcknowledgement = fc
  .uniqueArray(fc.uuid(), { minLength: 3, maxLength: 6 })
  .chain((pool) => {
    const someone = fc.constantFrom(...pool, ...pool.map((id) => id.toUpperCase()));
    return fc.record({
      alert: fc.option(
        fc.record({
          id: fc.uuid(),
          state: fc.constantFrom(...ALERT_STATES),
          acknowledgedBy: fc.option(someone, { nil: null }),
          responderIds: fc.subarray(pool),
        }),
        { nil: null },
      ),
      sender: someone,
    });
  });

describe('LOST-06 and AR-04: the alert rule is one module, total over its own lists', () => {
  // RG-03 (LOST-07, the spec's "Existing assertions that change by design",
  // line 1896): ALERT_EVENTS is exactly acknowledge and escalate, the second
  // alert event (LOST-07-AC13). The JOURNEY_EVENTS half is unchanged.
  // RG-03 (SM-10, the spec's "Existing assertions that change by design",
  // line 2118): ALERT_EVENTS gains acknowledger_removed, the reset (approach
  // item 4), and JOURNEY_EVENTS gains remove (approach item 2), each last.
  // Both still exact; none of the journey's events acknowledges.
  test('LOST-06-AC14: ALERT_EVENTS is exactly acknowledge, escalate and acknowledger_removed; JOURNEY_EVENTS is start, heartbeat, silence, contact, home and remove, and none of them acknowledges', () => {
    expect([...ALERT_EVENTS]).toEqual(['acknowledge', 'escalate', 'acknowledger_removed']);
    expect([...JOURNEY_EVENTS]).toEqual([
      'start',
      'heartbeat',
      'silence',
      'contact',
      'home',
      'remove',
    ]);
    expect(JOURNEY_EVENTS).not.toContain('acknowledge');
  });

  // RG-03 (LOST-07, the spec's "Existing assertions that change by design",
  // line 1902): the pairs it counts were an acknowledgement's situations
  // only; it counts the escalation's too, no alert and each of the four
  // states with nobody and someone recorded, with and without an escalation
  // time, under and at two minutes. The acknowledgement's are unchanged.
  test('LOST-06-AC14: every pair of alert situation and event the lists create has a row here, and no row is stale: no alert, and each of the four states with nobody, the sender and another on it, from a responder and from a non-responder', () => {
    const created = alertPairsTheModuleCreates();
    // RG-03 (SM-10, the spec's "Existing assertions that change by design",
    // line 2129): the rows held, and the count below, gain the reset's: no
    // alert, and each of the four states with nobody, the removed responder
    // and another recorded. The acknowledgement's and the escalation's are
    // as they were.
    const held = [...ALERT_ROWS, ...ESCALATION_ROWS, ...RESET_ROWS].map(
      ({ situation, event }) => `${situation} × ${event}`,
    );

    expect(
      created.filter((pair) => !held.includes(pair)),
      'pairs with no expected outcome in this test: write their rows before the code',
    ).toEqual([]);
    expect(
      held.filter((pair) => !created.includes(pair)),
      'rows for pairs the lists no longer create',
    ).toEqual([]);
    expect(held).toHaveLength(
      1 +
        ALERT_STATES.length * RECORDED.length * SENDERS.length +
        (1 +
          ALERT_STATES.length *
            ESCALATION_RECORDED.length *
            ESCALATION_TIMES.length *
            AGES.length) +
        (1 + ALERT_STATES.length * RESET_RECORDED.length),
    );
  });

  test.each(ALERT_ROWS)(
    'LOST-06-AC14: $situation × $event gives exactly its expected outcome',
    ({ situation, expected }) => {
      expect(alertTransition(alertFor(situation), acknowledgeBy(SENDER))).toEqual(expected);
    },
  );

  test('LOST-06-AC14: for any alert and any sender, the outcome is the rule’s, in its order — not found, then resolved, then the sender’s own, then taken, then acknowledged — never a throw, never undefined', () => {
    fc.assert(
      fc.property(anyAcknowledgement, ({ alert, sender }) => {
        let outcome: unknown;
        expect(() => {
          outcome = alertTransition(alert, acknowledgeBy(sender));
        }).not.toThrow();
        expect(outcome).toSatisfy(isOneOfTheAlertOutcomes);
        expect(outcome).toEqual(expectedAlertOutcome(alert, acknowledgeBy(sender)));
      }),
    );
  });

  test('LOST-06-AC14: IDs are compared exactly, as the stores hand them back lower-case: a responder’s ID in upper case is not that responder, and the sender recorded in upper case is someone else', () => {
    const responder = syntheticUuid();
    expect(responder.toUpperCase(), 'an ID with a letter in it').not.toBe(responder);
    const open = {
      id: ALERT,
      state: 'OPEN' as const,
      acknowledgedBy: null,
      responderIds: [responder],
    };

    expect(alertTransition(open, acknowledgeBy(responder.toUpperCase()))).toEqual(ALERT_NOT_FOUND);
    expect(alertTransition(open, acknowledgeBy(responder))).toEqual(ACKNOWLEDGED);
    expect(
      alertTransition(
        { ...open, acknowledgedBy: responder.toUpperCase() },
        acknowledgeBy(responder),
      ),
    ).toEqual(ALREADY_ACKNOWLEDGED);
  });

  test('LOST-06-AC14: an event of a type the module does not list is thrown on in every situation, with the rule’s own message, never answered with a value: Object.prototype’s names included', () => {
    // RG-03 (LOST-06 review loop 2, test-auditor's should-fix): sharpened,
    // and this comment corrected. The bare toThrow() took any throw, and the
    // controls never made it "the rule's own": with the rule's Object.hasOwn
    // guard gone, the table has no `escalate`, and calling what is not there
    // throws a TypeError, which passed. So the rule's own message is asserted
    // now, whole. And the types now include Object.prototype's names, which
    // without that guard reach a member every object inherits and answer a
    // value: `constructor` hands back an object, `toString` '[object Object]'.
    // That is the silent miss the throw exists to prevent.
    expect(alertTransition).toBeTypeOf('function');
    for (const { situation } of ALERT_ROWS) {
      // Control: in this situation the listed event is answered, with a value.
      expect(alertTransition(alertFor(situation), acknowledgeBy(SENDER)), situation).toBeDefined();
      for (const type of [
        // RG-03 (LOST-07, the spec's "Existing assertions that change by
        // design", line 1957): `escalate` was the unlisted example, and is
        // listed now (LOST-07-AC13). Another name the module does not list
        // takes its place; the rest, and the rule's own message, are unchanged.
        'snooze',
        'constructor',
        'toString',
        '__proto__',
        'hasOwnProperty',
        'valueOf',
      ]) {
        expect(
          () =>
            alertTransition(alertFor(situation), {
              type,
              responderId: SENDER,
            } as unknown as AcknowledgeEvent),
          `${situation}, ${type}`,
        ).toThrow(new RegExp(`^The alert rule has no rule for an event of type ${type}\\.$`));
      }
    }
  });

  test('LOST-06-AC14: deciding changes neither the alert nor the event handed in', () => {
    fc.assert(
      fc.property(anyAcknowledgement, ({ alert, sender }) => {
        const event = acknowledgeBy(sender);
        const alertBefore = structuredClone(alert);
        const eventBefore = structuredClone(event);

        alertTransition(alert, event);

        expect(alert).toEqual(alertBefore);
        expect(event).toEqual(eventBefore);
      }),
    );
  });
});

describe('LOST-06 and LOST-03: every message kind is withdrawn by exactly one rule, decided in one place', () => {
  // RG-03 (LOST-07, the spec's "Existing assertions that change by design",
  // line 2008): the list gains LOST_CONTACT_SMS, last, and the title with
  // it. Still exact, in order.
  // RG-03 (SM-10, the spec's "Existing assertions that change by design",
  // line 2249): the list gains NO_RESPONDER, last, and the title with it.
  // Still exact, in order.
  test('LOST-06-AC13: MESSAGE_KINDS is exactly LOST_CONTACT, BACK_IN_CONTACT, HOME, ACKNOWLEDGED, LOST_CONTACT_SMS and NO_RESPONDER, in order', () => {
    expect([...MESSAGE_KINDS]).toEqual([
      'LOST_CONTACT',
      'BACK_IN_CONTACT',
      'HOME',
      'ACKNOWLEDGED',
      'LOST_CONTACT_SMS',
      'NO_RESPONDER',
    ]);
  });

  // RG-03 (LOST-07, the spec's "Existing assertions that change by design",
  // line 2012): the resolution's list gains LOST_CONTACT_SMS (D-111: an
  // escalated alert's unsent SMS are withdrawn when it resolves), and the
  // title with it. The check that every kind is in exactly one of the two is
  // unchanged, and covers the new kind.
  // RG-03 (SM-10, the spec's "Existing assertions that change by design",
  // line 2264): the partition becomes one of three, with
  // JOURNEY_MESSAGE_KINDS: NO_RESPONDER is a journey's message, which
  // neither the resolution nor the open withdraws (D-123). Still exact, and
  // a kind placed in none, or in two, is still named; the title says so.
  test('LOST-06-AC13: WITHDRAWN_WHEN_RESOLVED is exactly LOST_CONTACT, ACKNOWLEDGED and LOST_CONTACT_SMS; the open’s list is ALERT_RESOLUTIONS; and every kind is in exactly one of the two or of the journey kinds, a kind in none or in two named here until someone places it', () => {
    // L1: assignable only while every kind listed is a message kind.
    const resolvedWithdraws: readonly MessageKind[] = WITHDRAWN_WHEN_RESOLVED;
    const openWithdraws: readonly MessageKind[] = ALERT_RESOLUTIONS;
    const journeyKinds: readonly MessageKind[] = JOURNEY_MESSAGE_KINDS;

    expect(journeyKinds, 'JOURNEY_MESSAGE_KINDS').toEqual(['NO_RESPONDER']);
    expect([...WITHDRAWN_WHEN_RESOLVED]).toEqual([
      'LOST_CONTACT',
      'ACKNOWLEDGED',
      'LOST_CONTACT_SMS',
    ]);
    expect([...openWithdraws]).toEqual(['BACK_IN_CONTACT', 'HOME']);
    const places = (kind: MessageKind) =>
      Number(resolvedWithdraws.includes(kind)) +
      Number(openWithdraws.includes(kind)) +
      Number(journeyKinds.includes(kind));
    expect(
      MESSAGE_KINDS.filter((kind) => places(kind) === 0),
      'kinds placed nowhere: place each in WITHDRAWN_WHEN_RESOLVED, ALERT_RESOLUTIONS or JOURNEY_MESSAGE_KINDS',
    ).toEqual([]);
    expect(
      MESSAGE_KINDS.filter((kind) => places(kind) > 1),
      'kinds placed twice: each kind belongs to exactly one',
    ).toEqual([]);
  });

  test('LOST-06-AC13: the test kit’s copies equal the domain’s: its MESSAGE_KINDS, the kinds its resolution withdraws, and the kinds its open withdraws', () => {
    // The test kit cannot import the server (its own index.ts says why), so
    // its copies are held to the domain's here, where both can be read.
    expect([...KIT_MESSAGE_KINDS]).toEqual([...MESSAGE_KINDS]);
    expect([...KIT_WITHDRAWN_WHEN_RESOLVED]).toEqual([...WITHDRAWN_WHEN_RESOLVED]);
    expect([...KIT_WITHDRAWN_WHEN_OPENED]).toEqual([...ALERT_RESOLUTIONS]);
    // RG-03 (LOST-07, the spec's "Existing assertions that change by design",
    // line 2033): added to, with the kit's three new copies. Nothing above
    // changed.
    expect([...KIT_SMS_KINDS]).toEqual([...SMS_KINDS]);
    expect([...KIT_PUSH_KINDS]).toEqual([...PUSH_KINDS]);
    expect([...KIT_WITHDRAWN_WHEN_ACKNOWLEDGED]).toEqual([...WITHDRAWN_WHEN_ACKNOWLEDGED]);
  });
});

// ===========================================================================
// LOST-07: escalation to SMS, the alert rule's second event (its spec's
// approach item 2).
//
// The rule, in its order, which is part of the rule:
//   1. no alert → unchanged;
//   2. RESOLVED → unchanged;
//   3. ACKNOWLEDGED with someone recorded → unchanged (D-114: both halves);
//   4. an escalation time already set → unchanged (once per alert);
//   5. two minutes or more since it opened (D-019, "or more") → escalated,
//      ESCALATED;
//   6. otherwise → unchanged.
// Both times are the database's, handed in; a time that is not one never
// escalates. The table above holds every pair; these hold the rest.
// ===========================================================================

describe('LOST-07 and AR-04: the escalation is the alert rule’s second event, total over its lists', () => {
  // RG-03 (SM-10, the spec's "Existing assertions that change by design",
  // line 2321): JOURNEY_EVENTS gains remove (SM-10-AC16), and the title no
  // longer says it is unchanged. Still exact; none of them escalates.
  test('LOST-07-AC13: ESCALATE_AFTER_MS is exactly 120 000 (D-019: changing it needs the owner); JOURNEY_EVENTS is start, heartbeat, silence, contact, home and remove, and none of them escalates', () => {
    expect(ESCALATE_AFTER_MS).toBe(120_000);
    expect(ESCALATE_AFTER_MS).toBe(TWO_MINUTES);
    expect([...JOURNEY_EVENTS]).toEqual([
      'start',
      'heartbeat',
      'silence',
      'contact',
      'home',
      'remove',
    ]);
    expect(JOURNEY_EVENTS).not.toContain('escalate');
  });

  test.each(ESCALATION_ROWS)(
    'LOST-07-AC13: $situation × $event gives exactly its expected outcome',
    ({ situation, expected }) => {
      expect(alertTransition(escalationFor(situation), escalateIn(situation))).toEqual(expected);
    },
  );

  test('LOST-07-AC13: the five escalated rows, and only they, are the situations the rule escalates: OPEN, ESCALATED with no escalation time, ACKNOWLEDGED with nobody recorded, and OPEN or ESCALATED with someone recorded, each at two minutes', () => {
    expect(
      ESCALATION_ROWS.filter(({ expected }) => expected.type === 'escalated').map(
        ({ situation }) => situation,
      ),
    ).toEqual([
      'OPEN; nobody recorded; no escalation time; two minutes',
      'OPEN; someone recorded; no escalation time; two minutes',
      'ESCALATED; nobody recorded; no escalation time; two minutes',
      'ESCALATED; someone recorded; no escalation time; two minutes',
      'ACKNOWLEDGED; nobody recorded; no escalation time; two minutes',
    ]);
  });

  test('LOST-07-AC13: for any alert and any two times, the escalation’s outcome is the rule’s, in its order — no alert, resolved, acknowledged by someone, already escalated, then two minutes or more — never a throw, never undefined', () => {
    fc.assert(
      fc.property(anyEscalation, ({ alert, ...times }) => {
        const event = escalationDrawn(times);
        let outcome: unknown;
        expect(() => {
          outcome = alertTransition(alert, event);
        }).not.toThrow();
        expect([ESCALATED, NOT_ESCALATED]).toContainEqual(outcome);
        expect(outcome).toEqual(expectedEscalation(alert, event));
      }),
    );
  });

  test('LOST-07-AC13: a time that is not one never escalates: an invalid now or an invalid opening, for an alert otherwise due', () => {
    const due: AlertForEscalation = {
      id: ALERT,
      state: 'OPEN',
      acknowledgedBy: null,
      smsRaisedAt: null,
    };
    const valid = new Date(OPENED_AT.getTime() + 10 * TWO_MINUTES);
    const invalid = new Date(Number.NaN);

    expect(alertTransition(due, { type: 'escalate', openedAt: OPENED_AT, now: valid })).toEqual(
      ESCALATED,
    );
    expect(alertTransition(due, { type: 'escalate', openedAt: OPENED_AT, now: invalid })).toEqual(
      NOT_ESCALATED,
    );
    expect(alertTransition(due, { type: 'escalate', openedAt: invalid, now: valid })).toEqual(
      NOT_ESCALATED,
    );
    expect(alertTransition(due, { type: 'escalate', openedAt: invalid, now: invalid })).toEqual(
      NOT_ESCALATED,
    );
  });

  test('LOST-07-AC3: a missing half fails toward the SMS: an alert otherwise due whose escalation time or acknowledger is undefined, or missing altogether, rather than null, is escalated, never read as already escalated or as someone recorded', () => {
    // The types forbid undefined, so these are built with a cast: what they
    // stand for is a row a future reader maps wrongly, or a field a refactor
    // drops (LOST-07 review loop 1, safety note; D-114: a missing half sends
    // the SMS). A rule that read undefined as "already escalated" or as
    // "someone is on it" would stay silent exactly when it cannot tell.
    const asRead = (fields: Record<string, unknown>) =>
      ({ id: ALERT, ...fields }) as unknown as AlertForEscalation;
    const when = {
      type: 'escalate',
      openedAt: OPENED_AT,
      now: new Date(OPENED_AT.getTime() + TWO_MINUTES),
    } as const;

    for (const [what, alert] of [
      [
        'OPEN, escalation time undefined',
        asRead({ state: 'OPEN', acknowledgedBy: null, smsRaisedAt: undefined }),
      ],
      [
        'ESCALATED, escalation time undefined',
        asRead({ state: 'ESCALATED', acknowledgedBy: null, smsRaisedAt: undefined }),
      ],
      [
        'ACKNOWLEDGED, acknowledger undefined',
        asRead({ state: 'ACKNOWLEDGED', acknowledgedBy: undefined, smsRaisedAt: null }),
      ],
      [
        'ACKNOWLEDGED, both undefined',
        asRead({ state: 'ACKNOWLEDGED', acknowledgedBy: undefined, smsRaisedAt: undefined }),
      ],
      ['ACKNOWLEDGED, both missing', asRead({ state: 'ACKNOWLEDGED' })],
      ['OPEN, both missing', asRead({ state: 'OPEN' })],
    ] as const) {
      expect(alertTransition(alert, when), what).toEqual(ESCALATED);
    }
    // The controls: a recorded acknowledger and a set escalation time still
    // stop it, so the escalations above are the missing halves' doing.
    expect(
      alertTransition(
        asRead({ state: 'ACKNOWLEDGED', acknowledgedBy: RESPONDER, smsRaisedAt: undefined }),
        when,
      ),
    ).toEqual(NOT_ESCALATED);
    expect(
      alertTransition(
        asRead({ state: 'OPEN', acknowledgedBy: undefined, smsRaisedAt: OPENED_AT }),
        when,
      ),
    ).toEqual(NOT_ESCALATED);
  });

  test('LOST-07-AC13: exactly two minutes escalates, and a millisecond under does not, counted from the opening the store read', () => {
    const due: AlertForEscalation = {
      id: ALERT,
      state: 'OPEN',
      acknowledgedBy: null,
      smsRaisedAt: null,
    };
    const at = (ms: number): EscalateEvent => ({
      type: 'escalate',
      openedAt: OPENED_AT,
      now: new Date(OPENED_AT.getTime() + ms),
    });

    expect(alertTransition(due, at(TWO_MINUTES - 1))).toEqual(NOT_ESCALATED);
    expect(alertTransition(due, at(TWO_MINUTES))).toEqual(ESCALATED);
    expect(alertTransition(due, at(TWO_MINUTES + 1))).toEqual(ESCALATED);
    // Before the opening: never.
    expect(alertTransition(due, at(-TWO_MINUTES))).toEqual(NOT_ESCALATED);
  });

  test('LOST-07-AC13: an event of a type the module does not list is thrown on in every escalation situation too, with the rule’s own message, never answered with a value: Object.prototype’s names included', () => {
    for (const { situation } of ESCALATION_ROWS) {
      // Control: in this situation the listed event is answered, with a value.
      expect(
        alertTransition(escalationFor(situation), escalateIn(situation)),
        situation,
      ).toBeDefined();
      for (const type of [
        'snooze',
        'constructor',
        'toString',
        '__proto__',
        'hasOwnProperty',
        'valueOf',
      ]) {
        expect(
          () =>
            alertTransition(escalationFor(situation), {
              ...escalateIn(situation),
              type,
            } as unknown as EscalateEvent),
          `${situation}, ${type}`,
        ).toThrow(new RegExp(`^The alert rule has no rule for an event of type ${type}\\.$`));
      }
    }
  });

  test('LOST-07-AC13: (L1) an event of a type the module does not list does not type-check: the overloads take an acknowledgement or an escalation, and nothing else', () => {
    // Each @ts-expect-error fails the type check (gate:static) the day the
    // call under it is accepted. The calls are made, so the throw is held too.
    expect(() =>
      // @ts-expect-error -- no alert event is a snooze
      alertTransition(null, { type: 'snooze', openedAt: OPENED_AT, now: OPENED_AT }),
    ).toThrow(/no rule for an event of type snooze/);
    expect(() =>
      // @ts-expect-error -- nor is an escalation without its two times
      alertTransition(null, { type: 'escalating' }),
    ).toThrow(/no rule for an event of type escalating/);
  });

  test('LOST-07-AC13: deciding changes neither the alert nor the event handed in', () => {
    fc.assert(
      fc.property(anyEscalation, ({ alert, ...times }) => {
        const event = escalationDrawn(times);
        const alertBefore = structuredClone(alert);
        const eventBefore = structuredClone(event);

        alertTransition(alert, event);

        expect(alert).toEqual(alertBefore);
        expect(event).toEqual(eventBefore);
      }),
    );
  });

  test('LOST-07-AC13: an ESCALATED alert can still be acknowledged, as LOST-06 built: the acknowledgement’s rows are unchanged', () => {
    expect(
      alertTransition(
        { id: ALERT, state: 'ESCALATED', acknowledgedBy: null, responderIds: [SENDER] },
        acknowledgeBy(SENDER),
      ),
    ).toEqual(ACKNOWLEDGED);
    expect(ALERT_TRANSITIONS.acknowledge['ESCALATED; nobody on it; sent by a responder']).toEqual(
      ACKNOWLEDGED,
    );
  });
});

describe('LOST-07, LOST-06 and LOST-03: every kind has one channel and one withdrawal, decided in one place', () => {
  // RG-03 (SM-10, the spec's "Existing assertions that change by design",
  // line 2528): the list gains NO_RESPONDER, last, and the title with it.
  // Still exact, in order.
  test('LOST-07-AC14: MESSAGE_KINDS is exactly LOST_CONTACT, BACK_IN_CONTACT, HOME, ACKNOWLEDGED, LOST_CONTACT_SMS and NO_RESPONDER, in order', () => {
    expect([...MESSAGE_KINDS]).toEqual([
      'LOST_CONTACT',
      'BACK_IN_CONTACT',
      'HOME',
      'ACKNOWLEDGED',
      'LOST_CONTACT_SMS',
      'NO_RESPONDER',
    ]);
  });

  // RG-03 (SM-10, the spec's "Existing assertions that change by design",
  // line 2538): PUSH_KINDS is the other five, NO_RESPONDER last, the
  // walker's warning going by push (approach item 7), and the title with it.
  // The channel partition is unchanged and covers the new kind.
  test('LOST-07-AC14: SMS_KINDS is exactly LOST_CONTACT_SMS, PUSH_KINDS exactly the other five in MESSAGE_KINDS’ order, and every kind is in exactly one of the two, a kind in neither or in both named here until someone places it', () => {
    // L1: assignable only while every kind listed is a message kind.
    const bySms: readonly MessageKind[] = SMS_KINDS;
    const byPush: readonly MessageKind[] = PUSH_KINDS;

    expect([...SMS_KINDS]).toEqual(['LOST_CONTACT_SMS']);
    expect([...PUSH_KINDS]).toEqual([
      'LOST_CONTACT',
      'BACK_IN_CONTACT',
      'HOME',
      'ACKNOWLEDGED',
      'NO_RESPONDER',
    ]);
    expect([...PUSH_KINDS]).toEqual(MESSAGE_KINDS.filter((kind) => byPush.includes(kind)));
    expect(
      MESSAGE_KINDS.filter((kind) => !bySms.includes(kind) && !byPush.includes(kind)),
      'kinds no channel lists: place each in SMS_KINDS or PUSH_KINDS',
    ).toEqual([]);
    expect(
      MESSAGE_KINDS.filter((kind) => bySms.includes(kind) && byPush.includes(kind)),
      'kinds both channels list: each kind goes by exactly one',
    ).toEqual([]);
  });

  // RG-03 (SM-10, the spec's "Existing assertions that change by design",
  // line 2556): the partition becomes one of three, with
  // JOURNEY_MESSAGE_KINDS, which neither withdrawal takes (D-123), and the
  // title with it. Still exact; a kind in none, or in two, still fails here.
  test('LOST-07-AC14: the SMS kind is withdrawn on resolution and not on an open: every kind is still in exactly one of WITHDRAWN_WHEN_RESOLVED, the open’s list, ALERT_RESOLUTIONS, and the journey kinds', () => {
    const resolvedWithdraws: readonly MessageKind[] = WITHDRAWN_WHEN_RESOLVED;
    const openWithdraws: readonly MessageKind[] = ALERT_RESOLUTIONS;
    const journeyKinds: readonly MessageKind[] = JOURNEY_MESSAGE_KINDS;

    expect(journeyKinds, 'JOURNEY_MESSAGE_KINDS').toEqual(['NO_RESPONDER']);
    expect(resolvedWithdraws).toContain('LOST_CONTACT_SMS');
    expect(openWithdraws).not.toContain('LOST_CONTACT_SMS');
    expect(
      MESSAGE_KINDS.filter(
        (kind) =>
          Number(resolvedWithdraws.includes(kind)) +
            Number(openWithdraws.includes(kind)) +
            Number(journeyKinds.includes(kind)) !==
          1,
      ),
      'kinds in no withdrawal and no journey kind, or in two',
    ).toEqual([]);
  });

  test('LOST-07-AC14: WITHDRAWN_WHEN_ACKNOWLEDGED is exactly LOST_CONTACT_SMS, and every kind in it is withdrawn on resolution too, a kind that is not named here', () => {
    const acknowledgedWithdraws: readonly MessageKind[] = WITHDRAWN_WHEN_ACKNOWLEDGED;
    const resolvedWithdraws: readonly MessageKind[] = WITHDRAWN_WHEN_RESOLVED;

    expect([...WITHDRAWN_WHEN_ACKNOWLEDGED]).toEqual(['LOST_CONTACT_SMS']);
    expect(
      acknowledgedWithdraws.filter((kind) => !resolvedWithdraws.includes(kind)),
      'kinds an acknowledgement withdraws that a resolution leaves',
    ).toEqual([]);
  });

  test('LOST-07-AC14: the test kit’s copies equal the domain’s: SMS_KINDS, PUSH_KINDS, WITHDRAWN_WHEN_ACKNOWLEDGED and WITHDRAWN_WHEN_RESOLVED', () => {
    expect([...KIT_SMS_KINDS]).toEqual([...SMS_KINDS]);
    expect([...KIT_PUSH_KINDS]).toEqual([...PUSH_KINDS]);
    expect([...KIT_WITHDRAWN_WHEN_ACKNOWLEDGED]).toEqual([...WITHDRAWN_WHEN_ACKNOWLEDGED]);
    expect([...KIT_WITHDRAWN_WHEN_RESOLVED]).toEqual([...WITHDRAWN_WHEN_RESOLVED]);
  });
});

// ===========================================================================
// SM-10: removing a responder (the removal, the journey's sixth event) and
// the reset (the alert rule's third), and SM-02's last responder.
//
// The removal's rule, in its order (approach item 2): no journey → refused,
// JOURNEY_NOT_FOUND; ENDED → ignored, JOURNEY_ENDED (SM-07); not among the
// responders (the walker included, IDs compared exactly) → unchanged,
// NOT_A_RESPONDER; otherwise → removed, the state as it was, and whether no
// responder is left. The reset's (approach item 4): no unresolved alert,
// RESOLVED, or someone other than the removed responder recorded, nobody
// included → unchanged; otherwise → reset, OPEN, whatever the state was. The
// tables above hold every pair; these hold the rest.
// ===========================================================================

/** The removal rule, in its order, as the spec writes it (approach item 2). */
function expectedRemoval(
  journey: JourneyForRemoval | null,
  { responderId }: RemoveEvent,
): RemoveOutcome {
  if (journey === null) {
    return REMOVAL_REFUSED;
  }
  if (journey.state === 'ENDED') {
    return REMOVAL_IGNORED;
  }
  if (!journey.responderIds.includes(responderId)) {
    return NOT_A_RESPONDER;
  }
  return REMOVED_FROM(
    journey.state,
    journey.responderIds.every((id) => id === responderId),
  );
}

/** The reset rule, in its order, as the spec writes it (approach item 4). */
function expectedReset(
  alert: AlertForReset | null,
  { responderId }: AcknowledgerRemovedEvent,
): ResetOutcome {
  if (alert === null || alert.state === 'RESOLVED') {
    return NOT_RESET;
  }
  return alert.acknowledgedBy === responderId ? RESET : NOT_RESET;
}

/**
 * Any journey, or none, and any responder to remove: IDs from a small pool, so
 * the one removed is often a responder, often the only one, and sometimes
 * named in another case, since the rule compares IDs exactly.
 */
const anyRemoval = fc.uniqueArray(fc.uuid(), { minLength: 2, maxLength: 5 }).chain((pool) => {
  const someone = fc.constantFrom(...pool, ...pool.map((id) => id.toUpperCase()));
  return fc.record({
    journey: fc.option(
      fc.record({
        id: fc.uuid(),
        state: fc.constantFrom(...JOURNEY_STATES),
        responderIds: fc.subarray(pool),
      }),
      { nil: null },
    ),
    responderId: someone,
  });
});

/** Any alert, or none, and any responder removed, from a small pool as above. */
const anyReset = fc.uniqueArray(fc.uuid(), { minLength: 2, maxLength: 4 }).chain((pool) => {
  const someone = fc.constantFrom(...pool, ...pool.map((id) => id.toUpperCase()));
  return fc.record({
    alert: fc.option(
      fc.record({
        id: fc.uuid(),
        state: fc.constantFrom(...ALERT_STATES),
        acknowledgedBy: fc.option(someone, { nil: null }),
      }),
      { nil: null },
    ),
    responderId: someone,
  });
});

describe('SM-10, SM-02 and AR-04: the removal is the journey’s sixth event, total over its lists', () => {
  test('SM-10-AC16: JOURNEY_EVENTS is exactly start, heartbeat, silence, contact, home and remove, and ALERT_EVENTS exactly acknowledge, escalate and acknowledger_removed, in order', () => {
    expect([...JOURNEY_EVENTS]).toEqual([
      'start',
      'heartbeat',
      'silence',
      'contact',
      'home',
      'remove',
    ]);
    expect([...ALERT_EVENTS]).toEqual(['acknowledge', 'escalate', 'acknowledger_removed']);
  });

  test.each(REMOVE_ROWS)(
    'SM-10-AC16: remove for $situation gives exactly its expected outcome (SM-02)',
    ({ journey, expected }) => {
      expect(transition(journey, remove(RESPONDER))).toEqual(expected);
    },
  );

  test('SM-10-AC16: the removal’s rows cover no journey and every state, each with the responder as the only one, as one of several, and not named; and the table’s rows agree with them', () => {
    expect(Object.keys(REMOVE_ROWS_BY_STATE).sort()).toEqual([...JOURNEY_STATES].sort());
    expect(REMOVE_ROWS).toHaveLength(1 + 3 * JOURNEY_STATES.length);
    for (const state of JOURNEY_STATES) {
      expect(TRANSITIONS.remove[state], state).toEqual({
        outcome: REMOVE_ROWS_BY_STATE[state].oneOfSeveral,
      });
    }
    expect(TRANSITIONS.remove.none).toEqual({ outcome: REMOVAL_REFUSED });
  });

  test('SM-10-AC1: the last responder is the one whose removal leaves no responder: removing either of two leaves one, and removing the only one leaves none, whatever unended state the journey is in (SM-02)', () => {
    for (const state of UNENDED) {
      const two = { id: JOURNEY, state, responderIds: [RESPONDER, OTHER_RESPONDER] };
      expect(transition(two, remove(RESPONDER)), state).toEqual(REMOVED_FROM(state, false));
      expect(transition(two, remove(OTHER_RESPONDER)), state).toEqual(REMOVED_FROM(state, false));
      expect(
        transition(
          { id: JOURNEY, state, responderIds: [OTHER_RESPONDER] },
          remove(OTHER_RESPONDER),
        ),
        state,
      ).toEqual(REMOVED_FROM(state, true));
    }
  });

  test('SM-10-AC1: IDs are compared exactly, as the stores hand them back lower-case: the walker’s own ID, a stranger’s, and a responder’s ID in upper case are each NOT_A_RESPONDER', () => {
    const responder = syntheticUuid();
    expect(responder.toUpperCase(), 'an ID with a letter in it').not.toBe(responder);
    const journey = { id: JOURNEY, state: 'ACTIVE' as const, responderIds: [responder] };

    for (const who of [WALKER, STRANGER, responder.toUpperCase()]) {
      expect(transition(journey, remove(who)), who).toEqual(NOT_A_RESPONDER);
    }
    expect(transition(journey, remove(responder))).toEqual(REMOVED_FROM('ACTIVE', true));
  });

  test('SM-10-AC16: for any journey and any responder, the removal’s outcome is the rule’s, in its order — no journey, ended, not a responder, then removed with whether it was the last — never a throw, never undefined (SM-02)', () => {
    fc.assert(
      fc.property(anyRemoval, ({ journey, responderId }) => {
        let outcome: unknown;
        expect(() => {
          outcome = transition(journey, remove(responderId));
        }).not.toThrow();
        expect(outcome).toBeDefined();
        expect(outcome).toEqual(expectedRemoval(journey, remove(responderId)));
      }),
    );
  });

  test('SM-10-AC16: deciding about a removal changes neither the journey nor the event handed in', () => {
    fc.assert(
      fc.property(anyRemoval, ({ journey, responderId }) => {
        const event = remove(responderId);
        const journeyBefore = structuredClone(journey);
        const eventBefore = structuredClone(event);

        transition(journey, event);

        expect(journey).toEqual(journeyBefore);
        expect(event).toEqual(eventBefore);
      }),
    );
  });

  test('SM-10-AC16: an event of a type the module does not list is thrown on in every removal situation, with the rule’s own message, never answered with a value', () => {
    for (const { situation, journey } of REMOVE_ROWS) {
      // Control: in this situation the listed event is answered, with a value.
      expect(transition(journey, remove(RESPONDER)), situation).toBeDefined();
      for (const type of ['teleport', 'leave', 'constructor', 'toString']) {
        expect(
          () => transition(journey, { type, responderId: RESPONDER } as unknown as RemoveEvent),
          `${situation}, ${type}`,
        ).toThrow(new RegExp(`^The state machine has no rule for an event of type ${type}\\.$`));
      }
    }
  });

  test('SM-10-AC16: (L1) a removal without the responder it removes does not type-check, nor one naming the walker’s device', () => {
    // Each @ts-expect-error fails the type check (gate:static) the day the
    // call under it is accepted. Values only; the calls are not made.
    const refused: unknown[] = [
      // @ts-expect-error -- a removal names the responder it removes
      { type: 'remove' } satisfies RemoveEvent,
      // @ts-expect-error -- and nothing else: not a device
      { type: 'remove', responderId: RESPONDER, deviceId: DEVICE } satisfies RemoveEvent,
    ];
    expect(refused).toHaveLength(2);
  });
});

describe('SM-10 and LOST-06: the reset is the alert rule’s third event, total over its lists', () => {
  test.each(RESET_ROWS)(
    'SM-10-AC16: $situation × $event gives exactly its expected outcome (LOST-06)',
    ({ situation, expected }) => {
      expect(alertTransition(resetFor(situation), acknowledgerRemoved(REMOVED))).toEqual(expected);
    },
  );

  test('SM-10-AC4: removing the responder recorded on an unresolved alert resets it to OPEN, whatever its state; removing another responder, or the acknowledger of a RESOLVED alert, changes nothing (LOST-06)', () => {
    for (const state of ['OPEN', 'ESCALATED', 'ACKNOWLEDGED'] as const) {
      expect(
        alertTransition(
          { id: ALERT, state, acknowledgedBy: REMOVED },
          acknowledgerRemoved(REMOVED),
        ),
        state,
      ).toEqual({ type: 'reset', state: 'OPEN' });
      expect(
        alertTransition({ id: ALERT, state, acknowledgedBy: ON_IT }, acknowledgerRemoved(REMOVED)),
        `${state}, someone else recorded`,
      ).toEqual({ type: 'unchanged' });
      expect(
        alertTransition({ id: ALERT, state, acknowledgedBy: null }, acknowledgerRemoved(REMOVED)),
        `${state}, nobody recorded`,
      ).toEqual({ type: 'unchanged' });
    }
    expect(
      alertTransition(
        { id: ALERT, state: 'RESOLVED', acknowledgedBy: REMOVED },
        acknowledgerRemoved(REMOVED),
      ),
    ).toEqual({ type: 'unchanged' });
    expect(alertTransition(null, acknowledgerRemoved(REMOVED))).toEqual({ type: 'unchanged' });
  });

  test('SM-10-AC16: the reset’s IDs are compared exactly: the acknowledger recorded in upper case is someone else', () => {
    expect(REMOVED.toUpperCase(), 'an ID with a letter in it').not.toBe(REMOVED);

    expect(
      alertTransition(
        { id: ALERT, state: 'ACKNOWLEDGED', acknowledgedBy: REMOVED.toUpperCase() },
        acknowledgerRemoved(REMOVED),
      ),
    ).toEqual(NOT_RESET);
    expect(
      alertTransition(
        { id: ALERT, state: 'ACKNOWLEDGED', acknowledgedBy: REMOVED },
        acknowledgerRemoved(REMOVED.toUpperCase()),
      ),
    ).toEqual(NOT_RESET);
  });

  test('SM-10-AC16: for any alert and any removed responder, the reset’s outcome is the rule’s, in its order — no alert, resolved, not the one recorded, then reset — never a throw, never undefined; deciding changes neither the alert nor the event handed in', () => {
    fc.assert(
      fc.property(anyReset, ({ alert, responderId }) => {
        const event = acknowledgerRemoved(responderId);
        const alertBefore = structuredClone(alert);
        const eventBefore = structuredClone(event);
        let outcome: unknown;
        expect(() => {
          outcome = alertTransition(alert, event);
        }).not.toThrow();
        expect([RESET, NOT_RESET]).toContainEqual(outcome);
        expect(outcome).toEqual(expectedReset(alert, event));
        expect(alert).toEqual(alertBefore);
        expect(event).toEqual(eventBefore);
      }),
    );
  });

  test('SM-10-AC16: an event of a type the module does not list is thrown on in every reset situation too, with the rule’s own message, never answered with a value', () => {
    for (const { situation } of RESET_ROWS) {
      // Control: in this situation the listed event is answered, with a value.
      expect(
        alertTransition(resetFor(situation), acknowledgerRemoved(REMOVED)),
        situation,
      ).toBeDefined();
      for (const type of ['snooze', 'acknowledger_left', 'constructor', 'valueOf']) {
        expect(
          () =>
            alertTransition(resetFor(situation), {
              type,
              responderId: REMOVED,
            } as unknown as AcknowledgerRemovedEvent),
          `${situation}, ${type}`,
        ).toThrow(new RegExp(`^The alert rule has no rule for an event of type ${type}\\.$`));
      }
    }
  });

  test('SM-10-AC16: (L1) a reset without the responder removed does not type-check', () => {
    // As above: the @ts-expect-error fails gate:static the day it is accepted.
    const refused: unknown[] = [
      // @ts-expect-error -- the reset names who was removed
      { type: 'acknowledger_removed' } satisfies AcknowledgerRemovedEvent,
    ];
    expect(refused).toHaveLength(1);
  });

  test('SM-10-AC16: the acknowledgement’s and the escalation’s rows are unchanged by the reset’s: an ESCALATED alert is still acknowledged, and an OPEN one nobody is on still escalated at two minutes', () => {
    expect(
      alertTransition(
        { id: ALERT, state: 'ESCALATED', acknowledgedBy: null, responderIds: [SENDER] },
        acknowledgeBy(SENDER),
      ),
    ).toEqual(ACKNOWLEDGED);
    expect(
      alertTransition(
        { id: ALERT, state: 'OPEN', acknowledgedBy: null, smsRaisedAt: null },
        { type: 'escalate', openedAt: OPENED_AT, now: new Date(OPENED_AT.getTime() + TWO_MINUTES) },
      ),
    ).toEqual(ESCALATED);
  });
});

describe('SM-10, LOST-06 and LOST-07: every kind has one channel and one place among the withdrawals, decided in one place', () => {
  test('SM-10-AC17: MESSAGE_KINDS is exactly the six kinds, NO_RESPONDER last', () => {
    expect([...MESSAGE_KINDS]).toEqual([
      'LOST_CONTACT',
      'BACK_IN_CONTACT',
      'HOME',
      'ACKNOWLEDGED',
      'LOST_CONTACT_SMS',
      'NO_RESPONDER',
    ]);
    expect(MESSAGE_KINDS.at(-1)).toBe('NO_RESPONDER');
  });

  test('SM-10-AC17: JOURNEY_MESSAGE_KINDS is exactly NO_RESPONDER; WITHDRAWN_WHEN_RESET exactly ACKNOWLEDGED, each kind in it also withdrawn on resolution; WITHDRAWN_WHEN_REMOVED exactly every kind that is not a journey’s, in MESSAGE_KINDS’ order', () => {
    // L1: assignable only while every kind listed is a message kind.
    const journeyKinds: readonly MessageKind[] = JOURNEY_MESSAGE_KINDS;
    const resetWithdraws: readonly MessageKind[] = WITHDRAWN_WHEN_RESET;
    const removalWithdraws: readonly MessageKind[] = WITHDRAWN_WHEN_REMOVED;

    expect(journeyKinds, 'JOURNEY_MESSAGE_KINDS').toEqual(['NO_RESPONDER']);
    expect(resetWithdraws, 'WITHDRAWN_WHEN_RESET').toEqual(['ACKNOWLEDGED']);
    expect(removalWithdraws, 'WITHDRAWN_WHEN_REMOVED').toEqual([
      'LOST_CONTACT',
      'BACK_IN_CONTACT',
      'HOME',
      'ACKNOWLEDGED',
      'LOST_CONTACT_SMS',
    ]);
    expect(removalWithdraws).toEqual(MESSAGE_KINDS.filter((kind) => !journeyKinds.includes(kind)));
    expect(
      resetWithdraws.filter(
        (kind) => !(WITHDRAWN_WHEN_RESOLVED as readonly string[]).includes(kind),
      ),
      'kinds a reset withdraws that a resolution leaves',
    ).toEqual([]);
  });

  test('SM-10-AC17: every kind is in exactly one of SMS_KINDS and PUSH_KINDS, and in exactly one of WITHDRAWN_WHEN_RESOLVED, the open’s list (ALERT_RESOLUTIONS) and JOURNEY_MESSAGE_KINDS; a kind placed in none, or in two, is named', () => {
    const bySms: readonly MessageKind[] = SMS_KINDS;
    const byPush: readonly MessageKind[] = PUSH_KINDS;
    const resolvedWithdraws: readonly MessageKind[] = WITHDRAWN_WHEN_RESOLVED;
    const openWithdraws: readonly MessageKind[] = ALERT_RESOLUTIONS;
    const journeyKinds: readonly MessageKind[] = JOURNEY_MESSAGE_KINDS;
    expect(journeyKinds, 'JOURNEY_MESSAGE_KINDS').toEqual(['NO_RESPONDER']);

    const channels = (kind: MessageKind) =>
      Number(bySms.includes(kind)) + Number(byPush.includes(kind));
    const places = (kind: MessageKind) =>
      Number(resolvedWithdraws.includes(kind)) +
      Number(openWithdraws.includes(kind)) +
      Number(journeyKinds.includes(kind));
    expect(
      MESSAGE_KINDS.filter((kind) => channels(kind) !== 1),
      'kinds in no channel, or in both',
    ).toEqual([]);
    expect(
      MESSAGE_KINDS.filter((kind) => places(kind) !== 1),
      'kinds in no place among the withdrawals and the journey kinds, or in two',
    ).toEqual([]);
    expect(byPush).toContain('NO_RESPONDER');
    expect(bySms).not.toContain('NO_RESPONDER');
  });

  test('SM-10-AC17: PUSH_KINDS is exactly the five kinds other than LOST_CONTACT_SMS, in MESSAGE_KINDS’ order; SMS_KINDS, WITHDRAWN_WHEN_RESOLVED, WITHDRAWN_WHEN_ACKNOWLEDGED and ALERT_RESOLUTIONS are unchanged', () => {
    expect([...PUSH_KINDS]).toEqual(MESSAGE_KINDS.filter((kind) => kind !== 'LOST_CONTACT_SMS'));
    expect([...PUSH_KINDS]).toHaveLength(5);
    expect([...SMS_KINDS]).toEqual(['LOST_CONTACT_SMS']);
    expect([...WITHDRAWN_WHEN_RESOLVED]).toEqual([
      'LOST_CONTACT',
      'ACKNOWLEDGED',
      'LOST_CONTACT_SMS',
    ]);
    expect([...WITHDRAWN_WHEN_ACKNOWLEDGED]).toEqual(['LOST_CONTACT_SMS']);
    expect([...ALERT_RESOLUTIONS]).toEqual(['BACK_IN_CONTACT', 'HOME']);
  });

  test('SM-10-AC17: the test kit’s copies equal the domain’s: MESSAGE_KINDS, PUSH_KINDS, JOURNEY_MESSAGE_KINDS, WITHDRAWN_WHEN_RESET and WITHDRAWN_WHEN_REMOVED', () => {
    // The test kit cannot import the server, so its copies are held to the
    // domain's here, where both can be read.
    const domain = {
      MESSAGE_KINDS: MESSAGE_KINDS as readonly string[] | undefined,
      PUSH_KINDS: PUSH_KINDS as readonly string[] | undefined,
      JOURNEY_MESSAGE_KINDS: JOURNEY_MESSAGE_KINDS as readonly string[] | undefined,
      WITHDRAWN_WHEN_RESET: WITHDRAWN_WHEN_RESET as readonly string[] | undefined,
      WITHDRAWN_WHEN_REMOVED: WITHDRAWN_WHEN_REMOVED as readonly string[] | undefined,
    };
    expect({
      MESSAGE_KINDS: [...KIT_MESSAGE_KINDS],
      PUSH_KINDS: [...KIT_PUSH_KINDS],
      JOURNEY_MESSAGE_KINDS: [...KIT_JOURNEY_MESSAGE_KINDS],
      WITHDRAWN_WHEN_RESET: [...KIT_WITHDRAWN_WHEN_RESET],
      WITHDRAWN_WHEN_REMOVED: [...KIT_WITHDRAWN_WHEN_REMOVED],
    }).toEqual(
      Object.fromEntries(
        Object.entries(domain).map(([name, list]) => [name, list === undefined ? list : [...list]]),
      ),
    );
  });
});
