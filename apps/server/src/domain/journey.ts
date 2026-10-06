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
 *   - Silence (the lost-contact story): the watchdog's question, asked with two
 *     database times the store read, when the journey's silence began and
 *     now. An ACTIVE journey silent for LOST_CONTACT_AFTER_MS or more (D-021,
 *     "or more") moves to LOST_CONTACT and opens an alert. Every other
 *     situation is unchanged: ACTIVE under the threshold, LOST_CONTACT, which
 *     is alerted once per silence, ENDED, and no journey. The rule reads no
 *     clock: both times are handed in, and a time that is not one (an invalid
 *     Date) never alerts, because no comparison with it holds.
 *   - Contact (the back-in-contact story): the store's question once it has
 *     stored a heartbeat, under the journey's row lock, with two database
 *     times: when the silence began, counted with that heartbeat, and the
 *     transaction's now. A LOST_CONTACT journey whose silence is under
 *     LOST_CONTACT_AFTER_MS is back in contact: ACTIVE again, its alert
 *     resolved. It is the silence rule asked the other way, at the same
 *     threshold, so the two can never disagree at the boundary. Every other
 *     situation is unchanged, and so is a time that is not one.
 *   - "I'm home" (D-110): heard on exactly the heartbeat's terms, in its order
 *     (not found, ended, not the journey's device), and then the journey ends,
 *     HOME. From LOST_CONTACT it also resolves the alert (SM-04).
 */

/** Every state a journey can be in (D-033). The database admits exactly these. */
export const JOURNEY_STATES = ['ACTIVE', 'LOST_CONTACT', 'ENDED'] as const;

/** Every event a journey can meet. */
export const JOURNEY_EVENTS = ['start', 'heartbeat', 'silence', 'contact', 'home'] as const;

/**
 * Every state an alert can be in (D-033), in order. The database admits
 * exactly these. Alerts open OPEN, and contact or "I'm home" resolves them;
 * ESCALATED and ACKNOWLEDGED belong to the tasks that escalate and
 * acknowledge them.
 */
export const ALERT_STATES = ['OPEN', 'ESCALATED', 'ACKNOWLEDGED', 'RESOLVED'] as const;

export type AlertState = (typeof ALERT_STATES)[number];

/**
 * Every kind of message an alert causes: the lost-contact alert, and the
 * stand-down for each way it resolves. The database admits exactly these.
 */
export const MESSAGE_KINDS = ['LOST_CONTACT', 'BACK_IN_CONTACT', 'HOME'] as const;

export type MessageKind = (typeof MESSAGE_KINDS)[number];

/**
 * Every way an alert resolves. Each is also the kind of the stand-down it
 * sends every responder, by its own name: held here at typecheck. The
 * database admits exactly these.
 */
export const ALERT_RESOLUTIONS = [
  'BACK_IN_CONTACT',
  'HOME',
] as const satisfies readonly MessageKind[];

export type AlertResolution = (typeof ALERT_RESOLUTIONS)[number];

/** Every reason a journey ends. The database admits exactly these. */
export const JOURNEY_END_REASONS = ['HOME'] as const;

export type JourneyEndReason = (typeof JOURNEY_END_REASONS)[number];

/**
 * Every reason the push port gives for not accepting a message, and no
 * others: one list, which the port, the outbox's check and the log all take.
 */
export const PUSH_FAILURE_REASONS = [
  'NO_TARGET',
  'REFUSED',
  'UNAVAILABLE',
  'NOT_CONFIGURED',
] as const;

export type PushFailureReason = (typeof PUSH_FAILURE_REASONS)[number];

/**
 * How long a journey may be silent before its responders are alerted: five
 * minutes, counted "or more" (D-021). Changing it needs the owner.
 */
export const LOST_CONTACT_AFTER_MS = 300_000;

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

/**
 * The watchdog asks about a journey's silence: when it began (last contact,
 * or the start when there has been none) and now, both read from the
 * database by the store, never from this process's clock (REL-01).
 */
export interface SilenceEvent {
  type: 'silence';
  silentSince: Date;
  now: Date;
}

/**
 * The store asks, once it has stored a heartbeat for a journey whose row it
 * holds, whether contact is back: when the silence began, counted with that
 * heartbeat, and the transaction's now, both database times (REL-01).
 */
export interface ContactEvent {
  type: 'contact';
  silentSince: Date;
  now: Date;
}

/** "I'm home" for the journey it names, from the device's own user and the device (D-110). */
export interface HomeEvent {
  type: 'home';
  walkerId: string;
  deviceId: string;
}

export type JourneyEvent = StartEvent | HeartbeatEvent | SilenceEvent | ContactEvent | HomeEvent;

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

/** Silent long enough: the journey is lost, and its alert opens. Or nothing changes. */
export type SilenceOutcome =
  { type: 'lost_contact'; state: 'LOST_CONTACT'; alert: 'OPEN' } | { type: 'unchanged' };

/** Back in contact: ACTIVE again, and the alert resolved. Or nothing changes. */
export type ContactOutcome =
  { type: 'back_in_contact'; state: 'ACTIVE'; alert: 'RESOLVED' } | { type: 'unchanged' };

/** Ended, HOME, resolving the alert when there is one to resolve; or not, and why, as for a heartbeat. */
export type HomeOutcome =
  { type: 'ended'; state: 'ENDED'; reason: 'HOME'; resolvesAlert: boolean } | HeartbeatRefusal;

export type TransitionOutcome =
  StartOutcome | HeartbeatOutcome | SilenceOutcome | ContactOutcome | HomeOutcome;

/**
 * What an event does. Every outcome, a refusal included, is a value; only an
 * event of a type this module does not list is thrown on.
 *
 * @param current for a start, the walker's unended journey, or null when there
 *   is none: an ENDED journey frees the walker, so one handed in is treated as
 *   none. For a heartbeat, the journey it names in any state, or null when no
 *   journey has that ID. For silence, the journey the watchdog read, by its
 *   ID and state, or null. For contact, the journey whose row the store
 *   holds, by its ID and state. For "I'm home", the journey it names, as for
 *   a heartbeat.
 *
 * The first five overloads are the ones callers use: each event with the
 * situation it needs, and the outcome it can have. The last, any situation
 * with any event, exists for the transition test's table, which reads its
 * types with `Parameters<typeof transition>` (the last overload) so that it
 * can ask every pair the lists create, a new event's included.
 */
export function transition(current: WalkersJourney | null, event: StartEvent): StartOutcome;
export function transition(
  current: JourneyForHeartbeat | null,
  event: HeartbeatEvent,
): HeartbeatOutcome;
export function transition(current: WalkersJourney | null, event: SilenceEvent): SilenceOutcome;
export function transition(current: WalkersJourney | null, event: ContactEvent): ContactOutcome;
export function transition(current: JourneyForHeartbeat | null, event: HomeEvent): HomeOutcome;
export function transition(current: Situation | null, event: JourneyEvent): TransitionOutcome;
export function transition(current: Situation | null, event: JourneyEvent): TransitionOutcome {
  switch (event.type) {
    case 'start':
      return start(current, event);
    case 'heartbeat':
      return heartbeat(current, event);
    case 'silence':
      return silence(current, event);
    case 'contact':
      return contact(current, event);
    case 'home':
      return home(current, event);
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
 * The heartbeat rule, in its order, which "I'm home" is heard by too: it
 * reads only who sent the event, the walker and the device. The order is part
 * of the rule:
 *   1. no journey by that ID, or another walker's: not found, one answer for
 *      both, so it says nothing about other walkers or their journeys (SEC-07);
 *   2. ENDED: ignored (SM-07), reported before anything else the heartbeat
 *      holds, as a start reports an unended journey first;
 *   3. not the device that started the journey: refused, so a device that is
 *      not walking can never hide the walking phone's silence (D-101);
 *   4. otherwise recorded, and the state stays as it is: ACTIVE stays ACTIVE
 *      (SM-03), and LOST_CONTACT stays LOST_CONTACT. Whether contact is back
 *      is the contact rule's, asked by the store once the heartbeat is stored,
 *      because it depends on times this read cannot know.
 */
function heartbeat(
  journey: Situation | null,
  sender: Pick<HeartbeatEvent, 'walkerId' | 'deviceId'>,
): HeartbeatOutcome {
  // No journey has no walker, so it is not the sender's either.
  if (journey?.walkerId !== sender.walkerId) {
    return { type: 'refused', reason: 'JOURNEY_NOT_FOUND' };
  }
  if (journey.state === 'ENDED') {
    return { type: 'ignored', reason: 'JOURNEY_ENDED' };
  }
  if (journey.deviceId !== sender.deviceId) {
    return { type: 'refused', reason: 'NOT_THE_JOURNEYS_DEVICE' };
  }
  return { type: 'recorded', state: journey.state };
}

/**
 * The silence rule (D-021). Only an ACTIVE journey is alerted, and only once
 * it has been silent for the threshold or more by the database's clock. A
 * journey already LOST_CONTACT is never alerted again for the same silence:
 * moving it back is the contact rule's, and until then its one alert stays
 * open. A comparison with a time that is not one never holds, so an invalid
 * moment changes nothing rather than alerting on a guess.
 */
function silence(journey: Situation | null, event: SilenceEvent): SilenceOutcome {
  if (journey?.state !== 'ACTIVE') {
    return { type: 'unchanged' };
  }
  if (event.now.getTime() - event.silentSince.getTime() >= LOST_CONTACT_AFTER_MS) {
    return { type: 'lost_contact', state: 'LOST_CONTACT', alert: 'OPEN' };
  }
  return { type: 'unchanged' };
}

/**
 * The contact rule: the silence rule asked the other way, at the same
 * threshold. Only a LOST_CONTACT journey is brought back, and only when its
 * silence, counted with the heartbeat just stored, is under
 * LOST_CONTACT_AFTER_MS by the database's clock. So a journey brought back is
 * never already overdue, and one whose heartbeat was received five minutes or
 * more before it was stored stays lost, its alert open. A comparison with a
 * time that is not one never holds, so an invalid moment resolves nothing.
 */
function contact(journey: Situation | null, event: ContactEvent): ContactOutcome {
  if (journey?.state !== 'LOST_CONTACT') {
    return { type: 'unchanged' };
  }
  if (event.now.getTime() - event.silentSince.getTime() < LOST_CONTACT_AFTER_MS) {
    return { type: 'back_in_contact', state: 'ACTIVE', alert: 'RESOLVED' };
  }
  return { type: 'unchanged' };
}

/**
 * The "I'm home" rule (D-110). Heard on exactly the heartbeat's terms, in its
 * order, because ending a journey stops all protection: not found for no
 * journey or another walker's, ignored once ENDED (SM-07), refused from a
 * device that did not start it (D-101). Otherwise the journey ends, HOME, and
 * from LOST_CONTACT its alert is resolved too (SM-04).
 */
function home(journey: Situation | null, event: HomeEvent): HomeOutcome {
  const heard = heartbeat(journey, event);
  if (heard.type !== 'recorded') {
    return heard;
  }
  return {
    type: 'ended',
    state: 'ENDED',
    reason: 'HOME',
    resolvesAlert: heard.state === 'LOST_CONTACT',
  };
}
