/**
 * The staging canary's fixed identities and its outcomes (REL-10, D-128),
 * written out because the test kit imports nothing from the server.
 *
 * The canary drives the real alert path with a test walker, a test responder
 * and the walker's one device, each a fixed, committed, random lower-case v4
 * UUID: what tells the canary's rows apart from every other (the spec's
 * approach item 4). The fake journey store's `registerCanary` writes these
 * three, as the adapter writes the domain's, and `domain/canary.test.ts` pins
 * the domain's constants to these values, so the fake and the adapter cannot
 * register different rows.
 *
 * Nothing about them is personal (RG-07; the repository is public, D-089).
 * They were chosen once, at random, by test-author in REL-10's red phase: the
 * tests had to pin them before the code existed (RG-02).
 */

/** The canary's three rows: its walker, its responder, and the walker's one device. */
export const CANARY_IDS = {
  walkerId: '6567904a-e65e-4f15-961f-bea85e86fb34',
  responderId: 'c7c43147-c1af-49e2-afe2-3a7aeb06717a',
  deviceId: 'f0920eb9-85b7-4e5b-8e6a-eeeb3d6f8342',
} as const;

/**
 * Every outcome a canary run can come to, in the spec's order (the
 * interfaces' `CANARY_OUTCOMES`): on time, a step's failure, a missed or early
 * alert, an escalation, a stand-down never answered, the run limit, and a
 * stop, which is not reported.
 */
export type FakeCanaryOutcome =
  | 'ON_TIME'
  | 'NOT_CONFIGURED'
  | 'REGISTER_FAILED'
  | 'START_FAILED'
  | 'HEARTBEAT_FAILED'
  | 'READ_FAILED'
  | 'OPENED_EARLY'
  | 'NOT_OPENED'
  | 'NOT_HANDED_OVER'
  | 'HOME_FAILED'
  | 'NOT_RESOLVED'
  | 'ESCALATED'
  | 'STAND_DOWN_NOT_HANDED_OVER'
  | 'RUN_LIMIT'
  | 'INTERRUPTED';

/** The outcomes, as a list, in the spec's order. */
export const FAKE_CANARY_OUTCOMES: readonly FakeCanaryOutcome[] = [
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
];
