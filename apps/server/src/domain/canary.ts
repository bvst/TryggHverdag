/**
 * The staging canary's rules: its identities, its timings, its outcomes, and
 * the verdict on whether its alert reached the push port in time (REL-10;
 * D-127, D-128).
 *
 * Every fifteen minutes the canary starts a journey for a fixed test walker,
 * naming a fixed test responder, beats once, goes silent, and watches the
 * real alert path: the watchdog must open the alert, and the push port must
 * answer the responder's lost-contact message, within the reliability
 * target's five minutes plus 60 s of last contact. What it decides, it
 * decides here, on the database's times alone, handed in by the module that
 * read them (AR-03):
 *   - the verdict: an alert that opened before the five minutes is a false
 *     alarm of its own (OPENED_EARLY); no alert by the deadline is
 *     NOT_OPENED; an alert the port had not answered by the deadline is
 *     NOT_HANDED_OVER, the wedged or stopped delivery loop D-108 left for the
 *     canary; otherwise ON_TIME, with both durations from last contact.
 *     Exactly at the deadline is on time. The answer's time is the now() of
 *     the first read that saw it, so polling can fail a run early by one
 *     poll and never pass it late;
 *   - the leftover rule: an unended canary journey started ten minutes or
 *     more ago is a run's that did not finish; a younger one is a run still
 *     in flight, which is never cut off;
 *   - what each outcome reports to the canary's own check: ok after ON_TIME
 *     alone, nothing after a stop, and failing, which pages at once, after
 *     every other.
 *
 * The three IDs are fixed, committed, random lower-case v4 UUIDs: what tells
 * the canary's rows apart from every other, with no flag column. Nothing about
 * them is personal (RG-07). The responder never gets a device, so nothing the
 * canary causes can reach a phone at the critical level (D-087).
 *
 * Pure: no clock, no I/O.
 */
import { LOST_CONTACT_AFTER_MS } from './journey.ts';
import { ALERT_TIME_SLACK_MS } from './watchdog.ts';

/** The canary's test walker: the user whose journeys the canary starts. */
export const CANARY_WALKER_ID = '6567904a-e65e-4f15-961f-bea85e86fb34';

/** The canary's test responder: named on every canary journey, and never given a device. */
export const CANARY_RESPONDER_ID = 'c7c43147-c1af-49e2-afe2-3a7aeb06717a';

/** The walker's one device, which starts, beats and ends every canary journey. */
export const CANARY_DEVICE_ID = 'f0920eb9-85b7-4e5b-8e6a-eeeb3d6f8342';

/**
 * How long after last contact the port's answer may come and still be on
 * time: the five-minute threshold plus the reliability target's 60 s.
 */
export const CANARY_DEADLINE_MS = LOST_CONTACT_AFTER_MS + ALERT_TIME_SLACK_MS;

/** How long after last contact the canary first looks: just before an alert could open. */
export const CANARY_FIRST_LOOK_MS = 290_000;

/** How often the canary reads while it watches. */
export const CANARY_POLL_MS = 2_000;

/** How long after the alert's resolution the port may take to answer the responder's stand-down. */
export const CANARY_STAND_DOWN_LIMIT_MS = 90_000;

/** How long ago an unended canary journey must have started to count as a leftover. */
export const CANARY_LEFTOVER_AFTER_MS = 600_000;

/** How long a run may take before it is aborted, and fails. */
export const CANARY_RUN_LIMIT_MS = 600_000;

/** How long a stopped run waits for the "I'm home" that ends its journey. */
export const CANARY_STOP_LIMIT_MS = 5_000;

/**
 * Every outcome a run can come to, in the order its steps can fail: on time;
 * the canary's own settings; its registration, the start, the heartbeat and a
 * read; an early, missing or unanswered alert; "I'm home", the resolution, an
 * escalation and the stand-down; the run limit; and a stop, which alone is not
 * reported.
 */
export const CANARY_OUTCOMES = [
  'ON_TIME',
  'NOT_CONFIGURED',
  'REGISTER_FAILED',
  'START_FAILED',
  'HEARTBEAT_FAILED',
  'READ_FAILED',
  'OPENED_EARLY',
  'NOT_OPENED',
  'NOT_HANDED_OVER',
  'HOME_FAILED',
  'NOT_RESOLVED',
  'ESCALATED',
  'STAND_DOWN_NOT_HANDED_OVER',
  'RUN_LIMIT',
  'INTERRUPTED',
] as const;

export type CanaryOutcome = (typeof CANARY_OUTCOMES)[number];

/**
 * What D-022's "missed canary alert" means for this canary (D-127): no alert
 * by the deadline, or one the port had not answered by then. A list the
 * monitoring guide and the run line name; no code decides by it.
 */
export const MISSED_ALERT_OUTCOMES = [
  'NOT_OPENED',
  'NOT_HANDED_OVER',
] as const satisfies readonly CanaryOutcome[];

/** The verdict on one alert, with its durations from last contact. */
export type AlertVerdict =
  | { outcome: 'ON_TIME'; alertMs: number; openedAfterMs: number }
  | { outcome: 'OPENED_EARLY' | 'NOT_OPENED' | 'NOT_HANDED_OVER'; openedAfterMs: number | null };

/**
 * Whether the alert reached the push port in time, from three database times:
 * last contact, the alert's opening (or none), and the now() of the first
 * read that saw the port's answer (or none).
 */
export function alertVerdict({
  lastContact,
  openedAt,
  answeredAt,
}: {
  lastContact: Date;
  openedAt: Date | null;
  answeredAt: Date | null;
}): AlertVerdict {
  if (openedAt === null) {
    return { outcome: 'NOT_OPENED', openedAfterMs: null };
  }
  const openedAfterMs = openedAt.getTime() - lastContact.getTime();
  if (openedAfterMs < LOST_CONTACT_AFTER_MS) {
    return { outcome: 'OPENED_EARLY', openedAfterMs };
  }
  const alertMs = answeredAt === null ? null : answeredAt.getTime() - lastContact.getTime();
  if (alertMs === null || alertMs > CANARY_DEADLINE_MS) {
    return { outcome: 'NOT_HANDED_OVER', openedAfterMs };
  }
  return { outcome: 'ON_TIME', alertMs, openedAfterMs };
}

/**
 * Whether an unended canary journey, started at `startedAt`, is at `now` a
 * leftover of a run that did not finish: started CANARY_LEFTOVER_AFTER_MS or
 * more before. Both are database times.
 */
export function isLeftover({ startedAt, now }: { startedAt: Date; now: Date }): boolean {
  return now.getTime() - startedAt.getTime() >= CANARY_LEFTOVER_AFTER_MS;
}

/** What a run that came to `outcome` tells the canary's check: ok, failing, or nothing at all. */
export function reportFor(outcome: CanaryOutcome): 'ok' | 'failing' | null {
  if (outcome === 'INTERRUPTED') {
    return null;
  }
  return outcome === 'ON_TIME' ? 'ok' : 'failing';
}
