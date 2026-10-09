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
 *   - "I'm on it" (LOST-06, D-114): an alert's own rule, `alertTransition`,
 *     over its own events, `ALERT_EVENTS`, because its situation is an
 *     alert's, not a journey's. Only a responder of the alert's journey may
 *     acknowledge it; one responder is on it; a resolved alert is over.
 *   - Escalation to SMS (LOST-07, D-116): the alert rule's second event, the
 *     watchdog's question, asked with two database times the store read,
 *     when the alert opened and now. An unresolved alert nobody is on, never
 *     escalated, and open for ESCALATE_AFTER_MS or more (D-019, "or more")
 *     is ESCALATED, and every responder gets an SMS. "Nobody is on it" is
 *     D-114's: a missing half of an acknowledgement (the state, or who) sends
 *     the SMS. Both times come through `databaseTime`, which throws on one
 *     that is not a time, so an unreadable time fails the sweep before this
 *     rule is asked.
 *   - Removing a responder (SM-10, and the last-responder half of SM-02,
 *     D-122, D-123): a journey event, `remove`, heard for an unended journey
 *     only (an ENDED one is ignored, SM-07), and only for one of its
 *     responders, IDs compared exactly. It never changes the journey's state;
 *     it says whether the responder removed was the last, so the walker is
 *     warned. And the alert rule's third event, `acknowledger_removed`: the
 *     unresolved alert the removed responder is recorded on goes back to OPEN,
 *     whatever its state, so escalation resumes; a RESOLVED alert keeps who
 *     helped on record.
 */

/** Every state a journey can be in (D-033). The database admits exactly these. */
export const JOURNEY_STATES = ['ACTIVE', 'LOST_CONTACT', 'ENDED'] as const;

/** Every event a journey can meet. */
export const JOURNEY_EVENTS = [
  'start',
  'heartbeat',
  'silence',
  'contact',
  'home',
  'remove',
] as const;

/**
 * Every state an alert can be in (D-033), in order. The database admits
 * exactly these. Alerts open OPEN; nobody acknowledging within two minutes
 * makes them ESCALATED (LOST-07), "I'm on it" ACKNOWLEDGED (LOST-06), and
 * contact or "I'm home" resolves them, whatever their state (D-112, D-116).
 * Removing the responder recorded on an unresolved alert puts it back to OPEN,
 * whatever its state, and it escalates again in its next round (SM-10, D-123).
 */
export const ALERT_STATES = ['OPEN', 'ESCALATED', 'ACKNOWLEDGED', 'RESOLVED'] as const;

export type AlertState = (typeof ALERT_STATES)[number];

/** Every event an alert can meet (LOST-06, LOST-07, SM-10): its own list, apart from the journey's. */
export const ALERT_EVENTS = ['acknowledge', 'escalate', 'acknowledger_removed'] as const;

/**
 * Every kind of message there is: those an alert causes, the lost-contact
 * alert, the stand-down for each way it resolves, the notice that someone is
 * on it (D-113) and the escalation SMS (D-019); and the walker's warning that
 * the journey's last responder was removed (SM-02, D-123), a journey's
 * message. The database admits exactly these.
 */
export const MESSAGE_KINDS = [
  'LOST_CONTACT',
  'BACK_IN_CONTACT',
  'HOME',
  'ACKNOWLEDGED',
  'LOST_CONTACT_SMS',
  'NO_RESPONDER',
] as const;

export type MessageKind = (typeof MESSAGE_KINDS)[number];

/**
 * The kinds that go by SMS, and only the SMS claim hands them out (LOST-07,
 * D-116). The kind names its channel, so the outbox's unique (alert,
 * recipient, kind) allows one push and one SMS per responder per alert, and
 * the push claim can never hand an SMS to the push port. Every kind is in
 * exactly one of this and PUSH_KINDS, and a test names any kind placed in
 * neither or both (LOST-07-AC14).
 */
export const SMS_KINDS = ['LOST_CONTACT_SMS'] as const satisfies readonly MessageKind[];

/**
 * The kinds that go by push: every other kind, in MESSAGE_KINDS' order. The
 * walker's warning is one, never at the critical level (D-087).
 */
export const PUSH_KINDS = [
  'LOST_CONTACT',
  'BACK_IN_CONTACT',
  'HOME',
  'ACKNOWLEDGED',
  'NO_RESPONDER',
] as const satisfies readonly MessageKind[];

/**
 * The kinds a journey's messages carry, with no alert (SM-02, D-123): the
 * walker's warning that the last responder was removed. Every kind is in
 * exactly one of this, WITHDRAWN_WHEN_RESOLVED and the open's list
 * (`ALERT_RESOLUTIONS`), and a test names any kind placed in none or two
 * (SM-10-AC17). Nothing withdraws a journey's message in M2: every withdrawal
 * is by alert, and the removal's by a recipient who is never the walker.
 */
export const JOURNEY_MESSAGE_KINDS = ['NO_RESPONDER'] as const satisfies readonly MessageKind[];

/**
 * The kinds an alert's resolution withdraws from its own alert while unsent
 * (D-111, D-113, D-116): its lost-contact pushes, its notices that someone is
 * on it, and its escalation SMS, all stale once the alert is over. Every kind
 * is withdrawn by exactly one rule, this one or the open's
 * (`ALERT_RESOLUTIONS`), and a test names any kind placed in neither or both
 * (LOST-06-AC13, LOST-07-AC14).
 */
export const WITHDRAWN_WHEN_RESOLVED = [
  'LOST_CONTACT',
  'ACKNOWLEDGED',
  'LOST_CONTACT_SMS',
] as const satisfies readonly MessageKind[];

/**
 * The kinds "I'm on it" withdraws from its own alert while unsent (LOST-07):
 * its escalation SMS, so escalation stops as soon as anyone acknowledges.
 * Each is also withdrawn on resolution, which a test holds (LOST-07-AC14).
 */
export const WITHDRAWN_WHEN_ACKNOWLEDGED = [
  'LOST_CONTACT_SMS',
] as const satisfies readonly MessageKind[];

/**
 * The kinds a reset withdraws from its own alert while unsent, when the
 * responder recorded on it is removed (SM-10, D-113's reasoning): its notices
 * that someone is on it, false once nobody is. Each is also withdrawn on
 * resolution, which a test holds (SM-10-AC17).
 */
export const WITHDRAWN_WHEN_RESET = ['ACKNOWLEDGED'] as const satisfies readonly MessageKind[];

/**
 * The kinds a removal withdraws while unsent from the removed responder, of
 * any of the journey's alerts (D-122, item 2: a removed responder receives
 * nothing more): every kind that is not a journey's, in MESSAGE_KINDS' order.
 */
export const WITHDRAWN_WHEN_REMOVED = [
  'LOST_CONTACT',
  'BACK_IN_CONTACT',
  'HOME',
  'ACKNOWLEDGED',
  'LOST_CONTACT_SMS',
] as const satisfies readonly MessageKind[];

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

/**
 * How long an alert may go unacknowledged before every responder gets an SMS:
 * two minutes from its opening, counted "or more" (D-019). Changing it needs
 * the owner.
 */
export const ESCALATE_AFTER_MS = 120_000;

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
 * The journey a removal names, in any state, and its responders as the store
 * read them (SM-10).
 */
export interface JourneyForRemoval {
  id: string;
  state: JourneyState;
  responderIds: readonly string[];
}

/**
 * What an event meets, as the module read it. A journey handed in without its
 * walker belongs to nobody a heartbeat can name, so it is not found; one
 * handed in without its responders has none a removal can name.
 *
 * The walker, the device and the responders are optional for the transition
 * test's table, not for any caller: the table asks every (situation, event)
 * pair through the last `transition` overload, with one situation type for
 * every event. The module hands a heartbeat a `JourneyForHeartbeat`, which
 * has the walker and the device, and a removal a `JourneyForRemoval`, which
 * has the responders.
 */
type Situation = WalkersJourney &
  Partial<Pick<JourneyForHeartbeat, 'walkerId' | 'deviceId'>> &
  Partial<Pick<JourneyForRemoval, 'responderIds'>>;

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

/** A responder is removed from the journey (SM-10): who, and nothing else. */
export interface RemoveEvent {
  type: 'remove';
  responderId: string;
}

export type JourneyEvent =
  StartEvent | HeartbeatEvent | SilenceEvent | ContactEvent | HomeEvent | RemoveEvent;

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

/**
 * Removed, the journey's state as it was, saying whether no responder is left
 * (SM-02's last responder); or not, and why: not one of its responders, the
 * journey over (SM-07), or no such journey.
 */
export type RemoveOutcome =
  | { type: 'removed'; state: UnendedJourneyState; lastResponder: boolean }
  | { type: 'unchanged'; reason: 'NOT_A_RESPONDER' }
  | { type: 'ignored'; reason: 'JOURNEY_ENDED' }
  | { type: 'refused'; reason: 'JOURNEY_NOT_FOUND' };

export type TransitionOutcome =
  StartOutcome | HeartbeatOutcome | SilenceOutcome | ContactOutcome | HomeOutcome | RemoveOutcome;

/**
 * An alert as "I'm on it" reads it (LOST-06): its state, who is recorded on
 * it, null for nobody, and its journey's responders, as the store read them.
 */
export interface AlertForAcknowledgement {
  id: string;
  state: AlertState;
  acknowledgedBy: string | null;
  responderIds: readonly string[];
}

/** A responder says "I'm on it" for the alert: the device's own user. */
export interface AcknowledgeEvent {
  type: 'acknowledge';
  responderId: string;
}

/** Why an acknowledgement is not recorded: the alert is over, or refused. */
export type AcknowledgeRefusal =
  | { type: 'ignored'; reason: 'ALERT_RESOLVED' }
  | { type: 'refused'; reason: 'ALERT_NOT_FOUND' | 'ALREADY_ACKNOWLEDGED' };

/** Recorded now; already the sender's, so nothing changes; or not, and why. */
export type AcknowledgeOutcome =
  | { type: 'acknowledged'; state: 'ACKNOWLEDGED' }
  | { type: 'unchanged'; reason: 'ALREADY_YOURS' }
  | AcknowledgeRefusal;

/**
 * An alert as the escalation reads it (LOST-07): its state, who is recorded
 * on it, null for nobody, and when it was escalated, null for never, as the
 * store read them.
 */
export interface AlertForEscalation {
  id: string;
  state: AlertState;
  acknowledgedBy: string | null;
  smsRaisedAt: Date | null;
}

/**
 * The watchdog asks whether an alert is escalated: when it opened and now,
 * both read from the database by the store, never from this process's clock
 * (REL-01).
 */
export interface EscalateEvent {
  type: 'escalate';
  openedAt: Date;
  now: Date;
}

/** Nobody on it for two minutes: ESCALATED, and every responder gets an SMS. Or nothing changes. */
export type EscalateOutcome = { type: 'escalated'; state: 'ESCALATED' } | { type: 'unchanged' };

/**
 * An alert as the reset reads it (SM-10): its state, and who is recorded on
 * it, null for nobody, as the store read them under the journey's row.
 */
export interface AlertForReset {
  id: string;
  state: AlertState;
  acknowledgedBy: string | null;
}

/** A responder of the alert's journey is removed (SM-10): who, and nothing else. */
export interface AcknowledgerRemovedEvent {
  type: 'acknowledger_removed';
  responderId: string;
}

/** Back to OPEN, nobody on it, so escalation resumes; or nothing changes. */
export type ResetOutcome = { type: 'reset'; state: 'OPEN' } | { type: 'unchanged' };

export type AlertEvent = AcknowledgeEvent | EscalateEvent | AcknowledgerRemovedEvent;

/**
 * What an alert event meets, as the store read it. The responders and the
 * escalation time are optional for the implementation, not for any caller:
 * each overload of `alertTransition` pairs an event with the situation it
 * needs, an acknowledgement with its journey's responders and an escalation
 * with its escalation time.
 */
type AlertSituation = Pick<AlertForAcknowledgement, 'id' | 'state' | 'acknowledgedBy'> &
  Partial<Pick<AlertForAcknowledgement, 'responderIds'>> &
  Partial<Pick<AlertForEscalation, 'smsRaisedAt'>>;

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
 *   a heartbeat. For a removal, the journey it names, in any state, with its
 *   responders, or null when no journey has that ID.
 *
 * The first six overloads are the ones callers use: each event with the
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
export function transition(current: JourneyForRemoval | null, event: RemoveEvent): RemoveOutcome;
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
    case 'remove':
      return remove(current, event);
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

/**
 * The removal rule (SM-10, D-123), in its order, which is part of the rule:
 *   1. no journey by that ID: refused, not found;
 *   2. ENDED: ignored (SM-07), before anything else, as a heartbeat is;
 *   3. not one of the journey's responders: unchanged, so a removal repeated
 *      after its first answer was lost is safe with no event ID (D-103's
 *      reading). The walker is never a responder, so the walker lands here.
 *      IDs are compared exactly: the stores hand them back in lower case;
 *   4. otherwise removed, the journey's state as it was, and the last
 *      responder when no other responder is left (SM-02), so the walker is
 *      warned.
 */
function remove(journey: Situation | null, { responderId }: RemoveEvent): RemoveOutcome {
  if (journey === null) {
    return { type: 'refused', reason: 'JOURNEY_NOT_FOUND' };
  }
  if (journey.state === 'ENDED') {
    return { type: 'ignored', reason: 'JOURNEY_ENDED' };
  }
  // A journey handed in without its responders has none to remove.
  if (journey.responderIds?.includes(responderId) !== true) {
    return { type: 'unchanged', reason: 'NOT_A_RESPONDER' };
  }
  return {
    type: 'removed',
    state: journey.state,
    lastResponder: journey.responderIds.every((id) => id === responderId),
  };
}

/**
 * What an alert's event does (LOST-06, LOST-07, SM-10). Every outcome, a
 * refusal included, is a value; only an event of a type this module does not
 * list is thrown on.
 *
 * @param alert the alert the event names, or null when no alert has that ID:
 *   for "I'm on it", with its journey's responders; for the escalation, with
 *   when it was escalated. For a removal, the journey's one unresolved alert,
 *   or null when it has none.
 *
 * Each overload is an event with the situation it needs, and the outcome it
 * can have.
 */
export function alertTransition(
  alert: AlertForAcknowledgement | null,
  event: AcknowledgeEvent,
): AcknowledgeOutcome;
export function alertTransition(
  alert: AlertForEscalation | null,
  event: EscalateEvent,
): EscalateOutcome;
export function alertTransition(
  alert: AlertForReset | null,
  event: AcknowledgerRemovedEvent,
): ResetOutcome;
export function alertTransition(
  alert: AlertSituation | null,
  event: AlertEvent,
): AcknowledgeOutcome | EscalateOutcome | ResetOutcome {
  switch (event.type) {
    case 'acknowledge':
      return acknowledge(alert, event);
    case 'escalate':
      return escalate(alert, event);
    case 'acknowledger_removed':
      return reset(alert, event);
    default: {
      // A type error the day an event joins AlertEvent without a case. And a
      // throw, never a value, for an event nobody handled: a value handed
      // back for it is a silent miss for whatever reads the outcome.
      const unhandled: never = event;
      throw new Error(
        `The alert rule has no rule for an event of type ${(unhandled as AlertEvent).type}.`,
      );
    }
  }
}

/**
 * The acknowledgement rule (D-114), in its order, which is part of the rule:
 *   1. no alert, or a sender who is not a responder of its journey: not
 *      found, one answer for both, so it says nothing about alerts the sender
 *      does not follow (SEC-07);
 *   2. RESOLVED: ignored, before anything else the alert holds;
 *   3. the sender already recorded: unchanged, so a repeat is safe (SM-08);
 *   4. someone else recorded: refused, because one responder is on it;
 *   5. otherwise ACKNOWLEDGED, by the sender. OPEN, ESCALATED, and
 *      ACKNOWLEDGED with nobody recorded, which the code never makes, are
 *      all acknowledged: a record with nobody on it is met in the safe
 *      direction.
 * IDs are compared exactly: the stores hand them back in lower case.
 */
function acknowledge(
  alert: AlertSituation | null,
  { responderId }: AcknowledgeEvent,
): AcknowledgeOutcome {
  // No alert is no journey's either, so the sender follows it no more; nor
  // does an alert handed in without its responders.
  if (alert?.responderIds?.includes(responderId) !== true) {
    return { type: 'refused', reason: 'ALERT_NOT_FOUND' };
  }
  if (alert.state === 'RESOLVED') {
    return { type: 'ignored', reason: 'ALERT_RESOLVED' };
  }
  if (alert.acknowledgedBy === responderId) {
    return { type: 'unchanged', reason: 'ALREADY_YOURS' };
  }
  if (alert.acknowledgedBy !== null) {
    return { type: 'refused', reason: 'ALREADY_ACKNOWLEDGED' };
  }
  return { type: 'acknowledged', state: 'ACKNOWLEDGED' };
}

/**
 * The escalation rule (LOST-07, D-114, D-116), in its order:
 *   1. no alert: unchanged;
 *   2. RESOLVED: unchanged, before anything else the alert holds;
 *   3. ACKNOWLEDGED with someone recorded: unchanged, someone is on it. Both
 *      halves are read, so a missing half (ACKNOWLEDGED with nobody, or
 *      someone recorded on an alert in another state) fails toward the SMS;
 *   4. already escalated: unchanged, once per alert;
 *   5. open for ESCALATE_AFTER_MS or more by the database's clock: ESCALATED;
 *   6. otherwise unchanged.
 * "Someone recorded" is a responder's ID, and "already escalated" a time:
 * anything else read there, undefined or a field left out included, is a half
 * that is missing, and fails toward the SMS too (D-114). "Already escalated"
 * is this round's: a reset clears the time, so the next round escalates
 * (SM-10, D-123).
 * Both times are the database's, read through `databaseTime`, which throws on
 * one that is not a time, so the sweep fails and pages before this rule is
 * asked. Were one to reach it, no comparison with it holds, so it would
 * escalate nothing: that is the throw's case, not a missing half.
 */
function escalate(alert: AlertSituation | null, { openedAt, now }: EscalateEvent): EscalateOutcome {
  if (alert === null || alert.state === 'RESOLVED') {
    return { type: 'unchanged' };
  }
  if (alert.state === 'ACKNOWLEDGED' && typeof alert.acknowledgedBy === 'string') {
    return { type: 'unchanged' };
  }
  if (alert.smsRaisedAt instanceof Date) {
    return { type: 'unchanged' };
  }
  if (now.getTime() - openedAt.getTime() >= ESCALATE_AFTER_MS) {
    return { type: 'escalated', state: 'ESCALATED' };
  }
  return { type: 'unchanged' };
}

/**
 * The reset rule (SM-10, D-123), in its order:
 *   1. no unresolved alert: unchanged;
 *   2. RESOLVED: unchanged. The alert is over, and who helped stays on record;
 *   3. someone other than the removed responder recorded, or nobody:
 *      unchanged. IDs are compared exactly, as the acknowledgement compares
 *      them;
 *   4. otherwise back to OPEN, whatever the state was, so escalation resumes.
 *      A record with the removed responder on it in another state (OPEN or
 *      ESCALATED with someone recorded, put in directly) is reset too: a
 *      half-done record is met in the safe direction, as D-114 met one.
 */
function reset(
  alert: AlertSituation | null,
  { responderId }: AcknowledgerRemovedEvent,
): ResetOutcome {
  if (alert === null || alert.state === 'RESOLVED') {
    return { type: 'unchanged' };
  }
  if (alert.acknowledgedBy !== responderId) {
    return { type: 'unchanged' };
  }
  return { type: 'reset', state: 'OPEN' };
}
