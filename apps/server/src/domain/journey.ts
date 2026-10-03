/**
 * The journey state machine: every state, every event and every transition,
 * in this one module and nowhere else (D-033).
 *
 * A later feature that needs a new state or event adds it to the lists below,
 * and from then on it cannot pass unnoticed: `transition` switches on the
 * event's type, and an event with no case is a type error in its default
 * (`const unhandled: never`); the transition test has no row for the new pair
 * (a type error there, and a failing test naming the pair).
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
 *   - The heartbeat (LOST-01): only for the walker's own journey (SEC-07),
 *     ignored once it has ENDED (SM-07), only from the device that started
 *     it (D-101), and otherwise recorded with the state unchanged (SM-03). The
 *     rule never sees the position, the battery or the event ID, so whether a
 *     heartbeat carried a position cannot change its outcome.
 */

/** Every state a journey can be in (D-033). The database admits exactly these. */
export const JOURNEY_STATES = ['ACTIVE', 'LOST_CONTACT', 'ENDED'] as const;

/** Every event a journey can meet. */
export const JOURNEY_EVENTS = ['start', 'heartbeat'] as const;

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

/** The journey a heartbeat names, in any state: whose it is, and which device started it (D-101). */
export interface JourneyForHeartbeat {
  id: string;
  state: JourneyState;
  walkerId: string;
  deviceId: string;
}

/**
 * What an event meets, as the module read it. A journey handed in without its
 * walker belongs to nobody a heartbeat can name, so it is not found.
 *
 * The walker and the device are optional for the transition test's table,
 * not for any caller: the table asks every (situation, event) pair through
 * the third `transition` overload, with one situation type for every event.
 * The module hands a heartbeat a `JourneyForHeartbeat`, which has both.
 */
type Situation = WalkersJourney & Partial<Pick<JourneyForHeartbeat, 'walkerId' | 'deviceId'>>;

/** A walker asks to start a journey, naming who should follow it. */
export interface StartEvent {
  type: 'start';
  walkerId: string;
  /** As the walker named them: possibly empty, possibly with repeats. */
  responderIds: readonly string[];
  /** Which of the named IDs exist as users. */
  existingUserIds: ReadonlySet<string>;
}

/**
 * A heartbeat arrives for the journey it names. Only who sent it: the
 * device's own user and the device. Its position, battery and event ID are
 * not here, so no rule can depend on them.
 */
export interface HeartbeatEvent {
  type: 'heartbeat';
  walkerId: string;
  deviceId: string;
}

export type JourneyEvent = StartEvent | HeartbeatEvent;

/** Why a start was refused. */
export type StartRefusal =
  | { type: 'refused'; reason: 'ALREADY_ON_A_JOURNEY'; journeyId: string }
  | { type: 'refused'; reason: 'INVALID_RESPONDER' | 'NO_RESPONDER' };

export type StartOutcome =
  { type: 'started'; state: 'ACTIVE'; responderIds: string[] } | StartRefusal;

/** Why a heartbeat is not recorded: ignored for an ended journey (SM-07), or refused. */
export type HeartbeatRefusal =
  | { type: 'ignored'; reason: 'JOURNEY_ENDED' }
  | { type: 'refused'; reason: 'JOURNEY_NOT_FOUND' | 'NOT_THE_JOURNEYS_DEVICE' };

export type HeartbeatOutcome = { type: 'recorded'; state: UnendedJourneyState } | HeartbeatRefusal;

export type TransitionOutcome = StartOutcome | HeartbeatOutcome;

/**
 * What an event does. Every outcome, a refusal included, is a value; only an
 * event of a type this module does not list is thrown on.
 *
 * @param current for a start, the walker's unended journey, or null when there
 *   is none: an ENDED journey frees the walker, so one handed in is treated as
 *   none. For a heartbeat, the journey it names in any state, or null when no
 *   journey has that ID.
 *
 * The first two overloads are the ones callers use: each event with the
 * situation it needs, and the outcome it can have. The third, any situation
 * with any event, exists for the transition test's table, which reads its
 * types with `Parameters<typeof transition>` (the last overload) so that it
 * can ask every pair the lists create, a new event's included.
 */
export function transition(current: WalkersJourney | null, event: StartEvent): StartOutcome;
export function transition(
  current: JourneyForHeartbeat | null,
  event: HeartbeatEvent,
): HeartbeatOutcome;
export function transition(current: Situation | null, event: JourneyEvent): TransitionOutcome;
export function transition(current: Situation | null, event: JourneyEvent): TransitionOutcome {
  switch (event.type) {
    case 'start':
      return start(current, event);
    case 'heartbeat':
      return heartbeat(current, event);
    default: {
      // A type error the day an event joins JourneyEvent without a case. And
      // a throw, never a value: a value handed back for an event nobody
      // handled is a silent miss for whatever reads the outcome.
      const unhandled: never = event;
      throw new Error(
        `The state machine has no rule for an event of type ${(unhandled as JourneyEvent).type}.`,
      );
    }
  }
}

/**
 * The start rule, in its order. The order is part of the rule: a walker who
 * already has a journey learns that first, whatever the list says, so a start
 * retried after its answer was lost always learns which journey it already has.
 */
function start(current: WalkersJourney | null, event: StartEvent): StartOutcome {
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

/**
 * The heartbeat rule, in its order. The order is part of the rule:
 *   1. no journey by that ID, or another walker's: not found, one answer for
 *      both, so it says nothing about other walkers or their journeys (SEC-07);
 *   2. ENDED: ignored (SM-07), reported before anything else the heartbeat
 *      holds, as a start reports an unended journey first;
 *   3. not the device that started the journey: refused, so a device that is
 *      not walking can never hide the walking phone's silence (D-101);
 *   4. otherwise recorded, and the state stays as it is: ACTIVE stays ACTIVE
 *      (SM-03), and LOST_CONTACT stays LOST_CONTACT until the back-in-contact
 *      task moves it. An open alert stays open: a false alarm that stays loud,
 *      never one closed silently.
 */
function heartbeat(journey: Situation | null, event: HeartbeatEvent): HeartbeatOutcome {
  // No journey has no walker, so it is not the sender's either.
  if (journey?.walkerId !== event.walkerId) {
    return { type: 'refused', reason: 'JOURNEY_NOT_FOUND' };
  }
  if (journey.state === 'ENDED') {
    return { type: 'ignored', reason: 'JOURNEY_ENDED' };
  }
  if (journey.deviceId !== event.deviceId) {
    return { type: 'refused', reason: 'NOT_THE_JOURNEYS_DEVICE' };
  }
  return { type: 'recorded', state: journey.state };
}
