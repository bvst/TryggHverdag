/**
 * The journey state machine: every state, every event and every transition,
 * in this one module and nowhere else (D-033).
 *
 * A later feature that needs a new state or event adds it to the lists below,
 * and from then on it cannot pass unnoticed: `transition` has no case for the
 * new event (a type error below), and the transition test has no row for the
 * new pair (a type error there, and a failing test naming the pair).
 *
 * Pure by construction: no clock, no database, no I/O. The module around it
 * reads what it needs, asks here, and writes what comes back.
 *
 * The rules decided here:
 *   - SM-01, its first sentence: one unended journey per walker. "Unended" is
 *     any state but ENDED, so a walker whose journey has lost contact still
 *     has that journey, and a state added later blocks a second journey by
 *     default, which is the safe direction.
 *   - SM-02, its start rule: a journey needs at least one responder to start.
 *     A responder is an existing user other than the walker.
 */

/** Every state a journey can be in (D-033). The database admits exactly these. */
export const JOURNEY_STATES = ['ACTIVE', 'LOST_CONTACT', 'ENDED'] as const;

/** Every event a journey can meet. */
export const JOURNEY_EVENTS = ['start'] as const;

export type JourneyState = (typeof JOURNEY_STATES)[number];
export type JourneyEventType = (typeof JOURNEY_EVENTS)[number];

/** Every state but the one that frees the walker. */
export type UnendedJourneyState = Exclude<JourneyState, 'ENDED'>;

/** A walker's journey that has not ended: what a start meets, if anything. */
export interface UnendedJourney {
  id: string;
  state: UnendedJourneyState;
}

/** A walker asks to start a journey, naming who should follow it. */
export interface StartEvent {
  type: 'start';
  walkerId: string;
  /** As the walker named them: possibly empty, possibly with repeats. */
  responderIds: readonly string[];
  /** Which of the named IDs exist as users. */
  existingUserIds: ReadonlySet<string>;
}

export type JourneyEvent = StartEvent;

/** Why a start was refused. */
export type StartRefusal =
  | { type: 'refused'; reason: 'ALREADY_ON_A_JOURNEY'; journeyId: string }
  | { type: 'refused'; reason: 'INVALID_RESPONDER' | 'NO_RESPONDER' };

export type TransitionOutcome =
  { type: 'started'; state: 'ACTIVE'; responderIds: string[] } | StartRefusal;

/**
 * What an event does to the walker's situation. Never throws: every outcome,
 * a refusal included, is a value.
 *
 * @param current the walker's unended journey, or null when there is none. An
 *   ENDED journey is never a current one.
 */
export function transition(current: UnendedJourney | null, event: JourneyEvent): TransitionOutcome {
  switch (event.type) {
    // With one event type the linter sees this case as always true, and it is,
    // today. The switch is here for the second type: the day it is added
    // without a case, `event.type` below stops being `never`, and that is a
    // type error. Remove this directive then; ESLint reports it once unused.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- see above
    case 'start':
      return start(current, event);
  }
  // Every event type has its case above, so no type is left here. An event
  // type added without a case makes this a type error. (`event.type`, not
  // `event`: TypeScript narrows a union of events, and today there is one.)
  const unhandled: never = event.type;
  return unhandled;
}

/**
 * The start rule, in its order. The order is part of the rule: a walker who
 * already has a journey learns that first, whatever the list says, so a start
 * retried after its answer was lost always learns which journey it already has.
 */
function start(current: UnendedJourney | null, event: StartEvent): TransitionOutcome {
  if (current !== null) {
    return { type: 'refused', reason: 'ALREADY_ON_A_JOURNEY', journeyId: current.id };
  }
  const { walkerId, responderIds, existingUserIds } = event;
  // The whole start is refused, not just the bad entry: dropping it quietly
  // would let a walker believe someone is following them who is not.
  if (responderIds.some((id) => id === walkerId || !existingUserIds.has(id))) {
    return { type: 'refused', reason: 'INVALID_RESPONDER' };
  }
  if (responderIds.length === 0) {
    return { type: 'refused', reason: 'NO_RESPONDER' };
  }
  // A responder named twice counts once, in the order first named.
  return { type: 'started', state: 'ACTIVE', responderIds: [...new Set(responderIds)] };
}
