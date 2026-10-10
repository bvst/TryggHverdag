/**
 * One set of expectations for the staging canary's store: the in-memory fake
 * and the real adapter over PostgreSQL (REL-10, D-100, D-128).
 *
 * The canary's system tests run it against the fake journey store, so they
 * prove the real canary only while the fake registers and reads as the
 * adapter does. The fake's own tests run this list at L2, and the canary's
 * integration test runs it at L3 against the real tables, through
 * `databaseCanaryStore` beside `databaseJourneyStore`. A rule kept by one and
 * not the other fails in one of the two runs.
 *
 * A list of its own, beside `JOURNEY_STORE_BEHAVIOUR` rather than in it: the
 * adapter is a file of its own (`adapters/canary.ts`), which only the worker
 * and tests may import, so the journey store's integration test does not run
 * these. The three are the spec's shared behaviours 1 to 3, with its wording
 * kept, and each case's steps in the order its subject allows:
 *   1. registration makes exactly the canary's three rows, again changes
 *      nothing, a new hash replaces the old, and a device of the canary's ID
 *      owned by another user is refused, writing nothing. The refusal comes
 *      first here: once the canary's device exists, nothing in a store can
 *      give it to anyone else;
 *   2. the canary's read reflects its journey, its alert, whether the port
 *      answered its responder's lost-contact message and stand-down, and its
 *      SMS count, at the store's now, each time the row's own; and it reads
 *      any other walker's journey as none, whatever that journey holds;
 *   3. a second start of the canary's walker is refused with the unended
 *      journey's ID, which is what the run's leftover and overlap rules read.
 *
 * The canary's IDs are `CANARY_IDS`, the fake's copy of the domain's, which
 * `domain/canary.test.ts` pins to the domain's: so at L3 the adapter, which
 * writes the domain's, is held to the same rows as the fake.
 */
import { expect } from 'vitest';
import { CANARY_IDS } from './canary-ids.ts';
import type {
  CanaryObservation,
  FakeAlertResolution,
  FakeAlertState,
  FakeJourneyState,
  InsertStartedResult,
  OpenLostContactAlertResult,
  OverdueJourneys,
  RecordHomeResult,
  StartedJourney,
} from './fake-journey-store.ts';
import type { MessageKind, PushFailureReason } from './fake-push.ts';
import type {
  AlertAsStored,
  JourneyEndAsStored,
  MessageAsStored,
  ResolutionAsStored,
} from './journey-store-behaviour.ts';
import { syntheticUuid } from './synthetic-ids.ts';

/** The canary's read as a store under test returns it: the server's `CanaryObservation`, by shape. */
export type CanaryObservationAsRead = CanaryObservation;

/** A device as a store under test holds it: its ID and its credential's hash, null where a store keeps none. */
export interface DeviceAsStored {
  id: string;
  credentialHash: string | null;
}

/**
 * The canary's store, with the journey store beside it and what a test needs
 * around them: making users and devices, putting rows in directly, and
 * reading back what a walker or a journey has.
 */
export interface CanaryStoreUnderTest {
  store: {
    /** REL-10: the canary's three rows, in one transaction; rejects, writing nothing, when refused. */
    registerCanary(request: { credentialHash: string }): Promise<void>;
    /** REL-10: one plain read of a canary journey at the store's now; null for any other. */
    observeCanaryJourney(journeyId: string): Promise<CanaryObservationAsRead | null>;
    existingUsers(ids: readonly string[]): Promise<ReadonlySet<string>>;
    insertStarted(journey: StartedJourney): Promise<InsertStartedResult>;
    unendedJourneyOf(walkerId: string): Promise<{ id: string; state: string } | null>;
    overdueJourneys(afterMs: number): Promise<OverdueJourneys>;
    openLostContactAlert(request: {
      journeyId: string;
      afterMs: number;
      lockWaitMs?: number | undefined;
    }): Promise<OpenLostContactAlertResult>;
    markSent(messageId: string): Promise<void>;
    markFailed(request: {
      messageId: string;
      reason: PushFailureReason;
      retryAfterMs: number;
    }): Promise<void>;
    recordHome(home: {
      journeyId: string;
      walkerId: string;
      deviceId: string;
    }): Promise<RecordHomeResult>;
  };
  /** The store's own now: the fake's clock, or the database's `now()`. */
  now(): Promise<Date>;
  /** A new user, by the store's own means. */
  addUser(): Promise<string>;
  /** A new device of this user, with this ID if given, by the store's own means; resolves to its ID. */
  addDevice(userId: string, deviceId?: string): Promise<string>;
  /** Deletes a device that no journey was started from, as a test's own setup. */
  removeDevice(deviceId: string): Promise<void>;
  /** Every device this user has, as stored, in any order. */
  devicesOf(userId: string): Promise<DeviceAsStored[]>;
  /** A journey put in directly, in any state, started from this device; resolves to its ID. */
  seedJourney(journey: {
    walkerId: string;
    deviceId: string;
    state: FakeJourneyState;
    responderIds: readonly string[];
    startedAt: Date;
    lastHeartbeatAt?: Date | null;
  }): Promise<string>;
  /** An alert put in directly, in any state; resolves to its ID. */
  seedAlert(alert: {
    journeyId: string;
    state: FakeAlertState;
    openedAt: Date;
    silentSince: Date;
    resolvedAt?: Date | null;
    resolution?: FakeAlertResolution | null;
    acknowledgedBy?: string | null;
    acknowledgedAt?: Date | null;
    smsRaisedAt?: Date | null;
  }): Promise<string>;
  /** An outbox message put in directly; resolves to its ID. */
  seedMessage(message: {
    alertId: string;
    recipientId: string;
    kind: MessageKind;
    createdAt: Date;
    nextAttemptAt: Date;
    attempts?: number;
    sentAt?: Date | null;
    lastFailure?: PushFailureReason | null;
    withdrawnAt?: Date | null;
  }): Promise<string>;
  /** The alerts this journey has, as stored, in any order. */
  alertsOf(journeyId: string): Promise<AlertAsStored[]>;
  /** Each alert of this journey's resolution, as stored, in any order. */
  resolutionsOf(journeyId: string): Promise<ResolutionAsStored[]>;
  /** The outbox messages of this journey's alerts, as stored, in any order. */
  messagesOf(journeyId: string): Promise<MessageAsStored[]>;
  /** The journey's last contact, null until its first heartbeat. */
  lastHeartbeatAt(journeyId: string): Promise<Date | null>;
  /** How the journey ended, or null if there is no such journey. */
  endOf(journeyId: string): Promise<JourneyEndAsStored | null>;
}

export interface CanaryStoreBehaviour {
  name: string;
  /** A plain function, not a method, so a runner can take it out of the case. */
  run: (subject: CanaryStoreUnderTest) => Promise<void>;
}

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
/** Five minutes (D-021): the lost-contact threshold the open is asked with. */
const LOST_CONTACT_AFTER_MS = 5 * MINUTE;

/** A credential's hash as the devices table keeps one: 64 hex digits, made fresh (RG-07). */
function syntheticHash(): string {
  return `${syntheticUuid()}${syntheticUuid()}`.replaceAll('-', '');
}

/** A moment this long before the store's now. */
async function ago(subject: CanaryStoreUnderTest, ms: number): Promise<Date> {
  return new Date((await subject.now()).getTime() - ms);
}

/** The canary's read, which must find the journey; and that it was taken at the store's now. */
async function observed(
  subject: CanaryStoreUnderTest,
  journeyId: string,
  what: string,
): Promise<CanaryObservationAsRead> {
  const before = await subject.now();
  const observation = await subject.store.observeCanaryJourney(journeyId);
  const after = await subject.now();
  expect(observation, `${what}: the canary’s read found its journey`).not.toBeNull();
  if (observation === null) {
    throw new Error('unreachable');
  }
  expect(observation.now.getTime(), `${what}: read at the store’s now`).toBeGreaterThanOrEqual(
    before.getTime(),
  );
  expect(observation.now.getTime(), `${what}: read at the store’s now`).toBeLessThanOrEqual(
    after.getTime(),
  );
  return observation;
}

/** The one message of this kind to this recipient on this journey's alerts. */
async function messageTo(
  subject: CanaryStoreUnderTest,
  journeyId: string,
  recipientId: string,
  kind: MessageKind,
): Promise<MessageAsStored> {
  const found = (await subject.messagesOf(journeyId)).filter(
    (message) => message.recipientId === recipientId && message.kind === kind,
  );
  expect(found, `one ${kind} to ${recipientId}`).toHaveLength(1);
  const [message] = found;
  if (message === undefined) {
    throw new Error('unreachable');
  }
  return message;
}

const sortedDevices = (devices: readonly DeviceAsStored[]) =>
  [...devices].sort((a, b) => a.id.localeCompare(b.id));

export const CANARY_STORE_BEHAVIOUR: readonly CanaryStoreBehaviour[] = [
  {
    name: 'REL-10-AC10: registerCanary makes the canary’s walker and responder and the walker’s one device with the credential’s hash, again changes nothing, a new hash replaces the old, and a device of the canary’s ID owned by another user is refused',
    run: async (subject) => {
      const { walkerId, responderId, deviceId } = CANARY_IDS;
      const canaryUsers = async () => [
        ...(await subject.store.existingUsers([walkerId, responderId])),
      ];

      // Refused first: a device with the canary's ID belongs to someone else.
      const someoneElse = await subject.addUser();
      await subject.addDevice(someoneElse, deviceId);
      const theirs = await subject.devicesOf(someoneElse);
      expect(theirs.map(({ id }) => id)).toEqual([deviceId]);

      await expect(
        subject.store.registerCanary({ credentialHash: syntheticHash() }),
        'a device of the canary’s ID owned by another user is refused',
      ).rejects.toThrow();
      expect(await canaryUsers(), 'the refused registration made no user').toEqual([]);
      expect(await subject.devicesOf(walkerId), 'nor a device for the walker').toEqual([]);
      expect(await subject.devicesOf(someoneElse), 'and left the other’s device as it was').toEqual(
        theirs,
      );

      // The other's device gone, as a test's own setup, the registration goes through.
      await subject.removeDevice(deviceId);
      const first = syntheticHash();
      await subject.store.registerCanary({ credentialHash: first });

      expect((await canaryUsers()).sort()).toEqual([walkerId, responderId].sort());
      expect(await subject.devicesOf(walkerId)).toEqual([{ id: deviceId, credentialHash: first }]);
      expect(await subject.devicesOf(responderId), 'the responder gets no device').toEqual([]);

      // Again, with the same hash: nothing changes.
      await subject.store.registerCanary({ credentialHash: first });

      expect((await canaryUsers()).sort()).toEqual([walkerId, responderId].sort());
      expect(sortedDevices(await subject.devicesOf(walkerId))).toEqual([
        { id: deviceId, credentialHash: first },
      ]);
      expect(await subject.devicesOf(responderId)).toEqual([]);

      // A rotated credential: its hash replaces the old one on the same device.
      const second = syntheticHash();
      await subject.store.registerCanary({ credentialHash: second });

      expect(await subject.devicesOf(walkerId)).toEqual([{ id: deviceId, credentialHash: second }]);
      expect(await subject.devicesOf(responderId)).toEqual([]);
      expect(await subject.devicesOf(someoneElse), 'the other user has no device now').toEqual([]);
    },
  },
  {
    name: 'REL-10-AC11: observeCanaryJourney reads the canary’s journey, its alert, whether the port answered the responder’s lost-contact message and stand-down, and its SMS count, at the store’s now, and reads any other walker’s journey as none',
    run: async (subject) => {
      const { walkerId, responderId, deviceId } = CANARY_IDS;
      await subject.store.registerCanary({ credentialHash: syntheticHash() });

      // Other walkers, whose journeys name the canary's responder too, in
      // every state, with alerts and messages of every kind to that responder
      // already answered: none of it may reach the canary's read.
      const stranger = await subject.addUser();
      const others: string[] = [];
      const otherKinds: MessageKind[] = [
        'LOST_CONTACT',
        'BACK_IN_CONTACT',
        'HOME',
        'ACKNOWLEDGED',
        'LOST_CONTACT_SMS',
        'SAFE',
        'EXPIRED',
      ];
      // One walker each: an ACTIVE journey with no alert; three LOST_CONTACT
      // journeys whose unresolved alert is OPEN, ESCALATED and ACKNOWLEDGED;
      // and an ENDED one. Each journey but the ACTIVE one also has a RESOLVED
      // alert. Every alert carries a message of every alert kind to the
      // canary's responder, each answered: HOME sent, the rest failed.
      const otherJourneys: { state: FakeJourneyState; unresolved: FakeAlertState | null }[] = [
        { state: 'ACTIVE', unresolved: null },
        { state: 'LOST_CONTACT', unresolved: 'OPEN' },
        { state: 'LOST_CONTACT', unresolved: 'ESCALATED' },
        { state: 'LOST_CONTACT', unresolved: 'ACKNOWLEDGED' },
        { state: 'ENDED', unresolved: null },
      ];
      for (const { state, unresolved } of otherJourneys) {
        const walker = await subject.addUser();
        const device = await subject.addDevice(walker);
        const journeyId = await subject.seedJourney({
          walkerId: walker,
          deviceId: device,
          state,
          responderIds: [responderId, stranger],
          startedAt: await ago(subject, 20 * MINUTE),
          lastHeartbeatAt: await ago(subject, 19 * MINUTE),
        });
        others.push(journeyId);
        if (state === 'ACTIVE') {
          continue;
        }
        const openedAt = await ago(subject, 14 * MINUTE);
        const silentSince = await ago(subject, 19 * MINUTE);
        const alertIds = [
          await subject.seedAlert({
            journeyId,
            state: 'RESOLVED',
            openedAt,
            silentSince,
            resolvedAt: await ago(subject, 13 * MINUTE),
            resolution: 'HOME',
          }),
        ];
        if (unresolved !== null) {
          alertIds.push(
            await subject.seedAlert({
              journeyId,
              state: unresolved,
              openedAt: await ago(subject, 12 * MINUTE),
              silentSince,
              ...(unresolved === 'ACKNOWLEDGED'
                ? { acknowledgedBy: stranger, acknowledgedAt: await ago(subject, 11 * MINUTE) }
                : {}),
              ...(unresolved === 'ESCALATED'
                ? { smsRaisedAt: await ago(subject, 10 * MINUTE) }
                : {}),
            }),
          );
        }
        for (const alertId of alertIds) {
          for (const kind of otherKinds) {
            await subject.seedMessage({
              alertId,
              recipientId: responderId,
              kind,
              createdAt: openedAt,
              nextAttemptAt: openedAt,
              attempts: 1,
              sentAt: kind === 'HOME' ? openedAt : null,
              lastFailure: kind === 'HOME' ? null : 'NOT_CONFIGURED',
            });
          }
        }
      }

      // The canary's journey: silent six minutes, so the open below opens it.
      const startedAt = await ago(subject, 8 * MINUTE);
      const lastContact = await ago(subject, 6 * MINUTE);
      const journeyId = await subject.seedJourney({
        walkerId,
        deviceId,
        state: 'ACTIVE',
        responderIds: [responderId],
        startedAt,
        lastHeartbeatAt: lastContact,
      });

      const quiet = await observed(subject, journeyId, 'before any alert');
      expect({ ...quiet, now: null }).toEqual({
        now: null,
        journey: { state: 'ACTIVE', startedAt, lastHeartbeatAt: lastContact, endReason: null },
        alert: null,
        lostContactAnswered: false,
        standDownAnswered: false,
        smsWritten: 0,
      });

      const opened = await subject.store.openLostContactAlert({
        journeyId,
        afterMs: LOST_CONTACT_AFTER_MS,
      });
      expect(opened.outcome).toBe('opened');
      const [alert] = await subject.alertsOf(journeyId);
      if (alert === undefined) {
        throw new Error('expected the canary’s alert to be stored');
      }
      // A lost-contact message to someone else on the canary's alert, answered:
      // only the responder's counts.
      await subject.seedMessage({
        alertId: alert.id,
        recipientId: stranger,
        kind: 'LOST_CONTACT',
        createdAt: alert.openedAt,
        nextAttemptAt: alert.openedAt,
        attempts: 1,
        lastFailure: 'NOT_CONFIGURED',
      });

      const open = await observed(subject, journeyId, 'the alert open, unanswered');
      expect({ ...open, now: null }).toEqual({
        now: null,
        journey: {
          state: 'LOST_CONTACT',
          startedAt,
          lastHeartbeatAt: lastContact,
          endReason: null,
        },
        alert: {
          id: alert.id,
          openedAt: alert.openedAt,
          state: 'OPEN',
          resolution: null,
          resolvedAt: null,
        },
        lostContactAnswered: false,
        standDownAnswered: false,
        smsWritten: 0,
      });

      // The port answers the responder's lost-contact message, with a reason.
      const lost = await messageTo(subject, journeyId, responderId, 'LOST_CONTACT');
      await subject.store.markFailed({
        messageId: lost.messageId,
        reason: 'NOT_CONFIGURED',
        retryAfterMs: 10 * SECOND,
      });
      // An escalation SMS written for the alert is counted.
      await subject.seedMessage({
        alertId: alert.id,
        recipientId: responderId,
        kind: 'LOST_CONTACT_SMS',
        createdAt: alert.openedAt,
        nextAttemptAt: alert.openedAt,
      });

      const answered = await observed(subject, journeyId, 'the lost-contact message answered');
      expect({
        lostContactAnswered: answered.lostContactAnswered,
        standDownAnswered: answered.standDownAnswered,
        smsWritten: answered.smsWritten,
        alert: answered.alert?.state,
      }).toEqual({
        lostContactAnswered: true,
        standDownAnswered: false,
        smsWritten: 1,
        alert: 'OPEN',
      });

      // "I'm home": the journey ends HOME, the alert resolves HOME, and the
      // responder's stand-down is written, not yet answered.
      const home = await subject.store.recordHome({ journeyId, walkerId, deviceId });
      expect(home.outcome).toBe('home');
      const [resolution] = await subject.resolutionsOf(journeyId);

      const ended = await observed(subject, journeyId, 'after "I’m home"');
      expect({ ...ended, now: null }).toEqual({
        now: null,
        journey: {
          state: 'ENDED',
          startedAt,
          lastHeartbeatAt: lastContact,
          endReason: (await subject.endOf(journeyId))?.endReason,
        },
        alert: {
          id: alert.id,
          openedAt: alert.openedAt,
          state: 'RESOLVED',
          resolution: 'HOME',
          resolvedAt: resolution?.resolvedAt,
        },
        lostContactAnswered: true,
        standDownAnswered: false,
        smsWritten: 1,
      });
      expect(ended.journey.endReason).toBe('HOME');
      expect(ended.alert?.resolvedAt).toBeInstanceOf(Date);
      expect(ended.journey.lastHeartbeatAt).toEqual(await subject.lastHeartbeatAt(journeyId));

      // The port answers the stand-down by accepting it: sent counts as answered too.
      const standDown = await messageTo(subject, journeyId, responderId, 'HOME');
      await subject.store.markSent(standDown.messageId);

      const stoodDown = await observed(subject, journeyId, 'the stand-down answered');
      expect(stoodDown.standDownAnswered).toBe(true);
      expect(stoodDown.lostContactAnswered).toBe(true);

      // Every other walker's journey, and a journey that does not exist, read as none.
      for (const other of [...others, syntheticUuid()]) {
        expect(await subject.store.observeCanaryJourney(other), other).toBeNull();
      }
    },
  },
  {
    name: 'REL-10-AC8: a second start of the canary’s walker while its journey is unended is refused with that journey’s ID',
    run: async (subject) => {
      const { walkerId, responderId, deviceId } = CANARY_IDS;
      await subject.store.registerCanary({ credentialHash: syntheticHash() });
      const start = async () =>
        subject.store.insertStarted({
          walkerId,
          deviceId,
          responderIds: [responderId],
          startedAt: await subject.now(),
        });

      const first = await start();
      expect(first.inserted, JSON.stringify(first)).toBe(true);
      const journeyId = first.inserted ? first.journeyId : '';

      expect(await start()).toEqual({ inserted: false, unendedJourneyId: journeyId });
      expect(await subject.store.unendedJourneyOf(walkerId)).toEqual({
        id: journeyId,
        state: 'ACTIVE',
      });

      // Ended, it blocks nothing: the next run's start is stored.
      await subject.store.recordHome({ journeyId, walkerId, deviceId });
      const next = await start();
      expect(next.inserted, JSON.stringify(next)).toBe(true);
      expect(next.inserted ? next.journeyId : journeyId).not.toBe(journeyId);
    },
  },
];
