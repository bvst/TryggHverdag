/**
 * The journey state machine: every state, every event and every transition,
 * in this one module and nowhere else (D-033).
 *
 * A later feature that needs a new state or event adds it to the lists below,
 * and from then on it cannot pass unnoticed: `transition` hands every event to
 * the start rule, which takes only a start (a type error below), and the
 * transition test has no row for the new pair (a type error there, and a
 * failing test naming the pair).
 *
 * Pure by construction: no clock, no database, no I/O. The module around it
 * reads what it needs, asks here, and writes what comes back.
 *
 * The rules decided here:
 *   - SM-01, its first sentence: one unended journey per walker. "Unended" is
 *     any state but ENDED, so a walker whose journey has lost contact still
 *     has that journey, and a state added later blocks a second journey by
 *     default, which is the safe direction. ENDED frees the walker: an ENDED
 *     journey handed in as the current one is no journey at all.
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

/** A walker's journey in any state, as a caller may hand it in. */
interface WalkersJourney {
  id: string;
  state: JourneyState;
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
 *   ENDED journey frees the walker, so one handed in is treated as none.
 */
export function transition(current: WalkersJourney | null, event: JourneyEvent): TransitionOutcome {
  // One event type, so its rule is called directly: a second event added to
  // JourneyEvent is not a StartEvent, so this call stops compiling until the
  // event is handled. Then bring back a switch on `event.type`, one case per
  // event, and a default that holds `const unhandled: never = event;` and
  // throws. Never return from that default: a value handed back for an event
  // nobody handled is a silent miss for whatever reads the outcome.
  return start(current, event);
}

/**
 * The start rule, in its order. The order is part of the rule: a walker who
 * already has a journey learns that first, whatever the list says, so a start
 * retried after its answer was lost always learns which journey it already has.
 */
function start(current: WalkersJourney | null, event: StartEvent): TransitionOutcome {
  if (current !== null && current.state !== 'ENDED') {
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
