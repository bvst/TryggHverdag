/**
 * One set of expectations for every group store: the in-memory fake and the
 * real adapters over PostgreSQL (GRP-01, D-100).
 *
 * The system tests run the API against the fake, so they prove the real
 * behaviour only while the fake behaves like the adapters. This suite holds
 * the two together, as `journey-store-behaviour.ts` does for the journeys: the
 * fake's own tests run it at L2, and `adapters/groups.integration.test.ts`
 * runs it at L3 against the real tables, through `adapters/groups.ts`, the
 * device authenticator, the journey store and the canary's registration.
 *
 * What every group store must do (the spec's approach items 2 to 9, D-136,
 * D-137):
 *   - the first admin, by the bootstrap, only while no group exists: the
 *     group, the ADMIN, one device holding only the SHA-256 of a fresh
 *     credential, and a GROUP_CREATED audit row, all at once; racing
 *     bootstraps leave one group (AC8);
 *   - the admin's invitation: a code of 20 of Crockford's characters, kept
 *     only as its SHA-256, expiring seven days after the store's now, with an
 *     INVITATION_CREATED audit row; nobody else's (AC1, AC9);
 *   - a join: one answer, `not_valid`, for every invalid invitation, writing
 *     nothing (AC2); one member and one device for an unused one (AC3);
 *     racing joins leave one (AC4); the same join retried with the same key
 *     re-issues that device's credential, unless the invitation has expired
 *     or its user has been removed (AC5); valid until seven days after its
 *     creation by the store's clock, expired from that moment (AC6);
 *   - the members, their names and roles, and nobody else (AC9); one ADMIN;
 *   - a device admitted FULL while its user is a member or it is the
 *     canary's, WALKER_ONLY while it started a journey not yet ended, and
 *     nowhere otherwise (AC11, AC21);
 *   - whom a walker may name, and a start that names anyone else refused
 *     under its lock (AC12, AC13); the canary's walker its own responder
 *     alone, and the canary's users nobody's responder and nobody's member
 *     (AC14, AC15);
 *   - the admin's removal of a member: its refusals, writing nothing (AC16);
 *     otherwise the membership and the member's responder rows on every
 *     unended journey at once, through SM-10's own step, and an audit row
 *     (AC17 to AC19); their own walk untouched (AC21); all or nothing when a
 *     journey's row cannot be had (AC20).
 *
 * Times are the store's own: the fake's clock, which stands still, or the
 * database's now(), which moves on while a test runs, so a subject says how
 * far from a threshold a time must be to be sure of its side
 * (`timeMarginMs`).
 *
 * Each behaviour is a value, a name and a function, so a runner states the
 * list with `test.each(GROUP_STORE_BEHAVIOUR)` and the fake's test file pins
 * the names: removing one changes an assertion in a test file, where the
 * gates and test-auditor see it. Each behaviour gets a store of its own, with
 * no group in it: the bootstrap's behaviours need an empty one.
 */
import { expect } from 'vitest';
import { CANARY_IDS } from './canary-ids.ts';
import type { AuthenticatedDevice } from './fake-device-authenticator.ts';
import type {
  CreateInvitationResult,
  FakeAlertState,
  FakeJourneyState,
  FakeRole,
  InsertStartedResult,
  JoinResult,
  JoinToRecord,
  MemberAsRead,
  RecordHomeResult,
  RemoveMemberResult,
  StartedJourney,
} from './fake-journey-store.ts';
import type { MessageKind } from './fake-push.ts';
import {
  BASE64URL_43,
  INVITATION_CODE,
  syntheticDisplayName,
  syntheticInvitationCode,
  syntheticJoinKey,
} from './synthetic-groups.ts';
import { syntheticUuid } from './synthetic-ids.ts';

/** A membership as a store under test holds it. */
export interface MembershipAsStored {
  userId: string;
  groupId: string;
  role: string;
  displayName: string;
}

/** An invitation as a store under test holds it: no code, only its hash. */
export interface InvitationAsStored {
  id: string;
  groupId: string;
  codeHash: string;
  createdBy: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  usedBy: string | null;
  joinKeyHash: string | null;
}

/** An audit row as a store under test holds it. */
export interface AuditAsStored {
  at: Date;
  actorId: string | null;
  action: string;
  subjectId: string | null;
}

/** A device as a store under test holds it: its ID and the hash it keeps. */
export interface GroupDeviceAsStored {
  id: string;
  credentialHash: string | null;
}

/** An alert's message as a store under test holds it, for the removal's behaviours. */
export interface RemovalMessageAsStored {
  messageId: string;
  recipientId: string;
  kind: string;
  withdrawnAt: Date | null;
}

/** A journey's own message, the walker's warning, as a store under test holds it. */
export interface WarningAsStored {
  recipientId: string;
  kind: string;
}

/** An alert, for the removal's reset, as a store under test holds it. */
export interface ResetAsStored {
  id: string;
  state: string;
  acknowledgedBy: string | null;
  round: number;
}

/**
 * The group store, with the journey store, the device authenticator and the
 * canary's registration beside it, and what a test needs around them.
 */
export interface GroupStoreUnderTest {
  store: {
    bootstrapGroup(request: { displayName: string }): Promise<JoinResult>;
    joinWithInvitation(request: JoinToRecord): Promise<JoinResult>;
    memberOf(userId: string): Promise<MemberAsRead | null>;
    members(): Promise<MemberAsRead[]>;
    createInvitation(request: { adminId: string }): Promise<CreateInvitationResult>;
    removeMember(request: { adminId: string; memberId: string }): Promise<RemoveMemberResult>;
    authenticate(credential: string): Promise<AuthenticatedDevice | null>;
    eligibleResponders(walkerId: string, ids: readonly string[]): Promise<ReadonlySet<string>>;
    insertStarted(journey: StartedJourney): Promise<InsertStartedResult>;
    recordHome(home: {
      journeyId: string;
      walkerId: string;
      deviceId: string;
    }): Promise<RecordHomeResult>;
    registerCanary(request: { credentialHash: string }): Promise<void>;
  };
  /** The store's own now: the fake's clock, or the database's now(). */
  now(): Promise<Date>;
  /** How far from a threshold a time must be to be sure of its side: 0 for the fake, whose clock stands still. */
  timeMarginMs: number;
  /** What the store keeps of a code, a key or a credential: its SHA-256, as lower-case hex. */
  hash(text: string): string;
  /** A user who is a member of nothing. */
  addUser(): Promise<string>;
  /** A member of the store's one group, the group put in first if there is none; with this ID if given. */
  addMember(options?: { role?: FakeRole; id?: string }): Promise<string>;
  /** A device of this user holding the SHA-256 of a fresh credential; its ID and the credential. */
  addDevice(userId: string): Promise<{ deviceId: string; credential: string }>;
  /** An invitation put in directly, made by this member, created `createdAgoMs` before the store's now; used if told so. */
  seedInvitation(invitation: {
    createdBy: string;
    createdAgoMs: number;
    used?: { by: string; joinKey: string } | null;
  }): Promise<{ id: string; invitationCode: string }>;
  /** A journey put in directly, in any state, started from this device; resolves to its ID. */
  seedJourney(journey: {
    walkerId: string;
    deviceId: string;
    state: FakeJourneyState;
    responderIds: readonly string[];
    startedAt: Date;
    lastHeartbeatAt?: Date | null;
  }): Promise<string>;
  /** An alert put in directly, in any state, with who is on it if anyone; resolves to its ID. */
  seedAlert(alert: {
    journeyId: string;
    state: FakeAlertState;
    openedAt: Date;
    silentSince: Date;
    acknowledgedBy?: string | null;
    acknowledgedAt?: Date | null;
    smsRaisedAt?: Date | null;
  }): Promise<string>;
  /** An outbox message put in directly, not sent; resolves to its ID. */
  seedMessage(message: {
    alertId: string;
    recipientId: string;
    kind: MessageKind;
    createdAt: Date;
    nextAttemptAt: Date;
  }): Promise<string>;
  /** The journey's responder rows, sorted. */
  respondersOf(journeyId: string): Promise<string[]>;
  /** The journey's state as stored. */
  stateOf(journeyId: string): Promise<string | null>;
  /** The journey's alerts: state, who is on it, and its round. */
  alertsOf(journeyId: string): Promise<ResetAsStored[]>;
  /** The messages of the journey's alerts. */
  messagesOf(journeyId: string): Promise<RemovalMessageAsStored[]>;
  /** The journey's own messages: the walker's warnings. */
  journeyMessagesOf(journeyId: string): Promise<WarningAsStored[]>;
  /** The groups stored: at most one. */
  groupsAsStored(): Promise<{ id: string }[]>;
  membershipsAsStored(): Promise<MembershipAsStored[]>;
  invitationsAsStored(): Promise<InvitationAsStored[]>;
  auditAsStored(): Promise<AuditAsStored[]>;
  /** Every device this user has, as stored. */
  devicesOf(userId: string): Promise<GroupDeviceAsStored[]>;
  /** How many users, and how many devices, the store holds in all. */
  userCount(): Promise<number>;
  deviceCount(): Promise<number>;
  /** Holds the journey's row in a transaction of its own until `release`. */
  hold(journeyId: string): Promise<{ release(): Promise<void> }>;
  /** Deletes this user's membership directly, as another transaction's removal would: nothing else. */
  removeMembershipRow(userId: string): Promise<void>;
}

export interface GroupStoreBehaviour {
  name: string;
  /** A plain function, not a method, so a runner can take it out of the case. */
  run: (subject: GroupStoreUnderTest) => Promise<void>;
}

/** How many bootstraps or joins race at once. */
export const GROUP_RACERS = 8;

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
/** Seven days (GRP-01, reading 4), written out: a wrong constant fails here as well as in the domain's tests. */
const SEVEN_DAYS = 7 * 24 * HOUR;

/** Everything a refusal must leave as it was, read back. */
async function snapshot(subject: GroupStoreUnderTest) {
  const byId = <T extends { id: string }>(rows: T[]) =>
    [...rows].sort((a, b) => a.id.localeCompare(b.id));
  return {
    groups: byId(await subject.groupsAsStored()),
    memberships: [...(await subject.membershipsAsStored())].sort((a, b) =>
      a.userId.localeCompare(b.userId),
    ),
    invitations: byId(await subject.invitationsAsStored()),
    audit: (await subject.auditAsStored()).length,
    users: await subject.userCount(),
    devices: await subject.deviceCount(),
  };
}

/** The join's answer, which must be `joined`. */
function joined(result: JoinResult): { userId: string; role: FakeRole; credential: string } {
  if (result.outcome !== 'joined') {
    throw new Error(`expected the join to be joined, but it was ${JSON.stringify(result)}`);
  }
  return result;
}

/** The invitation's answer, which must be `created`. */
function created(result: CreateInvitationResult): { invitationCode: string; expiresAt: Date } {
  if (result.outcome !== 'created') {
    throw new Error(`expected the invitation to be created, but it was ${JSON.stringify(result)}`);
  }
  return result;
}

/** An admin, and a code of theirs not yet used. */
async function invited(subject: GroupStoreUnderTest) {
  const adminId = await subject.addMember({ role: 'ADMIN' });
  const { invitationCode } = created(await subject.store.createInvitation({ adminId }));
  return { adminId, invitationCode };
}

/** A member who joined with an invitation: their ID, credential, the join key and the code. */
async function joinedMember(subject: GroupStoreUnderTest) {
  const { adminId, invitationCode } = await invited(subject);
  const joinKey = syntheticJoinKey();
  const displayName = syntheticDisplayName();
  const result = joined(
    await subject.store.joinWithInvitation({ invitationCode, joinKey, displayName }),
  );
  return { adminId, invitationCode, joinKey, displayName, ...result };
}

/** A moment `ms` before `moment`. */
const before = (moment: Date, ms: number): Date => new Date(moment.getTime() - ms);

/** Whether `moment` lies between the two readings of the store's now, both included. */
function within(moment: Date, from: Date, to: Date): boolean {
  return moment.getTime() >= from.getTime() && moment.getTime() <= to.getTime();
}

/** A walker with a device, and an unended journey of theirs followed by `responderIds`. */
async function walking(
  subject: GroupStoreUnderTest,
  walkerId: string,
  responderIds: readonly string[],
  state: FakeJourneyState = 'ACTIVE',
) {
  const { deviceId, credential } = await subject.addDevice(walkerId);
  const now = await subject.now();
  const journeyId = await subject.seedJourney({
    walkerId,
    deviceId,
    state,
    responderIds,
    startedAt: before(now, 20 * MINUTE),
    lastHeartbeatAt: before(now, MINUTE),
  });
  return { deviceId, credential, journeyId };
}

export const GROUP_STORE_BEHAVIOUR: readonly GroupStoreBehaviour[] = [
  {
    name: 'GRP-01-AC8: bootstrapGroup on an empty store makes, at once, the group, its ADMIN with the name given, one device holding only the SHA-256 of a fresh 43-character credential, and one GROUP_CREATED audit row naming the admin; the credential authenticates FULL',
    async run(subject) {
      const displayName = syntheticDisplayName();
      const from = await subject.now();

      const result = await subject.store.bootstrapGroup({ displayName });

      const to = await subject.now();
      expect(result).toEqual({
        outcome: 'joined',
        userId: expect.any(String) as unknown,
        role: 'ADMIN',
        credential: expect.stringMatching(BASE64URL_43) as unknown,
      });
      const { userId, credential } = joined(result);
      const [group, ...others] = await subject.groupsAsStored();
      expect(others).toEqual([]);
      expect(await subject.membershipsAsStored()).toEqual([
        { userId, groupId: group?.id, role: 'ADMIN', displayName },
      ]);
      const devices = await subject.devicesOf(userId);
      expect(devices).toEqual([
        { id: expect.any(String) as unknown, credentialHash: subject.hash(credential) },
      ]);
      expect(await subject.userCount()).toBe(1);
      expect(await subject.deviceCount()).toBe(1);
      const audit = await subject.auditAsStored();
      expect(audit).toEqual([
        expect.objectContaining({ action: 'GROUP_CREATED', actorId: userId }) as unknown,
      ]);
      expect(within(audit[0]?.at ?? new Date(Number.NaN), from, to)).toBe(true);
      expect(await subject.store.authenticate(credential)).toEqual({
        deviceId: devices[0]?.id,
        userId,
        access: 'FULL',
      });
      expect(await subject.store.memberOf(userId)).toEqual({ userId, displayName, role: 'ADMIN' });
    },
  },
  {
    name: 'GRP-01-AC2 and AC8: once a group exists, bootstrapGroup is not_valid and writes nothing: no second group, admin, user, device or audit row, whether the group came from a bootstrap or not',
    async run(subject) {
      joined(await subject.store.bootstrapGroup({ displayName: syntheticDisplayName() }));
      const first = await snapshot(subject);

      expect(await subject.store.bootstrapGroup({ displayName: syntheticDisplayName() })).toEqual({
        outcome: 'not_valid',
      });
      expect(await snapshot(subject)).toEqual(first);
    },
  },
  {
    name: 'GRP-01-AC8: bootstraps racing on an empty store leave exactly one group and one admin: one is joined, every other not_valid',
    async run(subject) {
      const results = await Promise.all(
        Array.from({ length: GROUP_RACERS }, () =>
          subject.store.bootstrapGroup({ displayName: syntheticDisplayName() }),
        ),
      );

      const winners = results.filter((result) => result.outcome === 'joined');
      expect(winners).toHaveLength(1);
      expect(results.filter((result) => result.outcome === 'not_valid')).toHaveLength(
        GROUP_RACERS - 1,
      );
      expect(await subject.groupsAsStored()).toHaveLength(1);
      expect(
        (await subject.membershipsAsStored()).map(({ userId, role }) => ({ userId, role })),
      ).toEqual([{ userId: joined(winners[0] ?? { outcome: 'not_valid' }).userId, role: 'ADMIN' }]);
      expect(await subject.userCount()).toBe(1);
      expect(await subject.deviceCount()).toBe(1);
      expect(await subject.auditAsStored()).toHaveLength(1);
    },
  },
  {
    name: 'GRP-01-AC1: the admin’s createInvitation is created: a code of 20 of Crockford’s characters, expiring exactly seven days after it was made at the store’s now; only the code’s SHA-256 is stored, with its maker; and one INVITATION_CREATED audit row names the admin and the invitation',
    async run(subject) {
      const adminId = await subject.addMember({ role: 'ADMIN' });
      const from = await subject.now();

      const result = await subject.store.createInvitation({ adminId });

      const to = await subject.now();
      const { invitationCode, expiresAt } = created(result);
      expect(invitationCode).toMatch(INVITATION_CODE);
      const [invitation, ...others] = await subject.invitationsAsStored();
      expect(others).toEqual([]);
      const [group] = await subject.groupsAsStored();
      expect(invitation).toEqual({
        id: expect.any(String) as unknown,
        groupId: group?.id,
        codeHash: subject.hash(invitationCode),
        createdBy: adminId,
        createdAt: expect.any(Date) as unknown,
        expiresAt,
        usedAt: null,
        usedBy: null,
        joinKeyHash: null,
      });
      const createdAt = invitation?.createdAt ?? new Date(Number.NaN);
      expect(within(createdAt, from, to)).toBe(true);
      expect(expiresAt.getTime() - createdAt.getTime()).toBe(SEVEN_DAYS);
      expect(JSON.stringify(invitation)).not.toContain(invitationCode);
      const audit = await subject.auditAsStored();
      expect(audit).toEqual([
        {
          at: expect.any(Date) as unknown,
          actorId: adminId,
          action: 'INVITATION_CREATED',
          subjectId: invitation?.id,
        },
      ]);
      expect(within(audit[0]?.at ?? new Date(Number.NaN), from, to)).toBe(true);
    },
  },
  {
    name: 'GRP-01-AC9: createInvitation by a member who is not the admin, by a user who is no member, or by an ID that is no user is not_the_admin, and writes nothing',
    async run(subject) {
      await subject.addMember({ role: 'ADMIN' });
      const member = await subject.addMember();
      const plainUser = await subject.addUser();
      const first = await snapshot(subject);

      for (const adminId of [member, plainUser, syntheticUuid()]) {
        expect(await subject.store.createInvitation({ adminId }), adminId).toEqual({
          outcome: 'not_the_admin',
        });
      }
      expect(await snapshot(subject)).toEqual(first);
    },
  },
  {
    name: 'GRP-01-AC3: an unused invitation brings in one member: joined MEMBER with a new user, the name given, one device holding only the SHA-256 of a fresh 43-character credential; the invitation used at the store’s now, by that user, with the join key’s SHA-256; the credential authenticates FULL',
    async run(subject) {
      const { invitationCode } = await invited(subject);
      const joinKey = syntheticJoinKey();
      const displayName = syntheticDisplayName();
      const users = await subject.userCount();
      const from = await subject.now();

      const result = await subject.store.joinWithInvitation({
        invitationCode,
        joinKey,
        displayName,
      });

      const to = await subject.now();
      expect(result).toEqual({
        outcome: 'joined',
        userId: expect.any(String) as unknown,
        role: 'MEMBER',
        credential: expect.stringMatching(BASE64URL_43) as unknown,
      });
      const { userId, credential } = joined(result);
      expect(await subject.userCount()).toBe(users + 1);
      expect(await subject.store.memberOf(userId)).toEqual({ userId, displayName, role: 'MEMBER' });
      const [group] = await subject.groupsAsStored();
      expect(
        (await subject.membershipsAsStored()).find((membership) => membership.userId === userId),
      ).toEqual({ userId, groupId: group?.id, role: 'MEMBER', displayName });
      const devices = await subject.devicesOf(userId);
      expect(devices).toEqual([
        { id: expect.any(String) as unknown, credentialHash: subject.hash(credential) },
      ]);
      const [invitation] = await subject.invitationsAsStored();
      expect(invitation).toMatchObject({ usedBy: userId, joinKeyHash: subject.hash(joinKey) });
      expect(within(invitation?.usedAt ?? new Date(Number.NaN), from, to)).toBe(true);
      expect(JSON.stringify(invitation)).not.toContain(joinKey);
      expect(await subject.store.authenticate(credential)).toEqual({
        deviceId: devices[0]?.id,
        userId,
        access: 'FULL',
      });
    },
  },
  {
    name: 'GRP-01-AC2: a code no invitation has, of the right shape, is not_valid, and writes nothing',
    async run(subject) {
      await invited(subject);
      const first = await snapshot(subject);

      expect(
        await subject.store.joinWithInvitation({
          invitationCode: syntheticInvitationCode(),
          joinKey: syntheticJoinKey(),
          displayName: syntheticDisplayName(),
        }),
      ).toEqual({ outcome: 'not_valid' });
      expect(await snapshot(subject)).toEqual(first);
    },
  },
  {
    name: 'GRP-01-AC2 and AC4: a used invitation sent with another join key is not_valid, and writes nothing',
    async run(subject) {
      const { invitationCode } = await joinedMember(subject);
      const first = await snapshot(subject);

      expect(
        await subject.store.joinWithInvitation({
          invitationCode,
          joinKey: syntheticJoinKey(),
          displayName: syntheticDisplayName(),
        }),
      ).toEqual({ outcome: 'not_valid' });
      expect(await snapshot(subject)).toEqual(first);
    },
  },
  {
    name: 'GRP-01-AC5: the same code sent again with the same join key is the same join retried: the same user and role, a new credential, the same one device now holding the new credential’s SHA-256; the first credential authenticates nowhere; still one user, membership and device',
    async run(subject) {
      const member = await joinedMember(subject);
      const [device] = await subject.devicesOf(member.userId);
      const first = await snapshot(subject);

      const again = await subject.store.joinWithInvitation({
        invitationCode: member.invitationCode,
        joinKey: member.joinKey,
        displayName: member.displayName,
      });

      expect(again).toEqual({
        outcome: 'joined',
        userId: member.userId,
        role: 'MEMBER',
        credential: expect.stringMatching(BASE64URL_43) as unknown,
      });
      const { credential } = joined(again);
      expect(credential).not.toBe(member.credential);
      expect(await subject.devicesOf(member.userId)).toEqual([
        { id: device?.id, credentialHash: subject.hash(credential) },
      ]);
      expect(await subject.store.authenticate(member.credential)).toBeNull();
      expect(await subject.store.authenticate(credential)).toEqual({
        deviceId: device?.id,
        userId: member.userId,
        access: 'FULL',
      });
      const after = await snapshot(subject);
      expect({ ...after, invitations: undefined }).toEqual({ ...first, invitations: undefined });
      expect(after.invitations.map(({ usedBy, joinKeyHash }) => ({ usedBy, joinKeyHash }))).toEqual(
        first.invitations.map(({ usedBy, joinKeyHash }) => ({ usedBy, joinKeyHash })),
      );
    },
  },
  {
    name: 'GRP-01-AC5: the same code with the same join key is not_valid, writing nothing, once its user has been removed, and once the invitation has expired',
    async run(subject) {
      // Removed: the admin's removal, then the retry.
      const removed = await joinedMember(subject);
      expect(
        await subject.store.removeMember({ adminId: removed.adminId, memberId: removed.userId }),
      ).toEqual({ outcome: 'removed' });
      const afterRemoval = await snapshot(subject);
      expect(
        await subject.store.joinWithInvitation({
          invitationCode: removed.invitationCode,
          joinKey: removed.joinKey,
          displayName: removed.displayName,
        }),
      ).toEqual({ outcome: 'not_valid' });
      expect(await snapshot(subject)).toEqual(afterRemoval);

      // Expired: an invitation used by a member who is still one, made seven
      // days ago, retried with its own key.
      const memberId = await subject.addMember();
      const joinKey = syntheticJoinKey();
      const { invitationCode } = await subject.seedInvitation({
        createdBy: removed.adminId,
        createdAgoMs: SEVEN_DAYS,
        used: { by: memberId, joinKey },
      });
      await subject.addDevice(memberId);
      const beforeRetry = await snapshot(subject);
      expect(
        await subject.store.joinWithInvitation({
          invitationCode,
          joinKey,
          displayName: syntheticDisplayName(),
        }),
      ).toEqual({ outcome: 'not_valid' });
      expect(await snapshot(subject)).toEqual(beforeRetry);
    },
  },
  {
    name: 'GRP-01-AC6: an invitation is valid until seven days after it was made, by the store’s clock, and expired from that very moment: made seven days ago it is not_valid and writes nothing; made a moment less than seven days ago, it joins',
    async run(subject) {
      const adminId = await subject.addMember({ role: 'ADMIN' });
      const expired = await subject.seedInvitation({
        createdBy: adminId,
        createdAgoMs: SEVEN_DAYS,
      });
      const valid = await subject.seedInvitation({
        createdBy: adminId,
        createdAgoMs: SEVEN_DAYS - Math.max(1, subject.timeMarginMs),
      });
      const first = await snapshot(subject);

      expect(
        await subject.store.joinWithInvitation({
          invitationCode: expired.invitationCode,
          joinKey: syntheticJoinKey(),
          displayName: syntheticDisplayName(),
        }),
      ).toEqual({ outcome: 'not_valid' });
      expect(await snapshot(subject)).toEqual(first);

      const result = await subject.store.joinWithInvitation({
        invitationCode: valid.invitationCode,
        joinKey: syntheticJoinKey(),
        displayName: syntheticDisplayName(),
      });
      expect(result.outcome).toBe('joined');
    },
  },
  {
    name: 'GRP-01-AC4: joins racing with one invitation and different join keys: exactly one is joined, every other not_valid; one user, one membership and one device come of it',
    async run(subject) {
      const { invitationCode } = await invited(subject);
      const first = await snapshot(subject);

      const results = await Promise.all(
        Array.from({ length: GROUP_RACERS }, () =>
          subject.store.joinWithInvitation({
            invitationCode,
            joinKey: syntheticJoinKey(),
            displayName: syntheticDisplayName(),
          }),
        ),
      );

      expect(results.filter((result) => result.outcome === 'joined')).toHaveLength(1);
      expect(results.filter((result) => result.outcome === 'not_valid')).toHaveLength(
        GROUP_RACERS - 1,
      );
      const after = await snapshot(subject);
      expect(after.users).toBe(first.users + 1);
      expect(after.memberships).toHaveLength(first.memberships.length + 1);
      expect(after.devices).toBe(first.devices + 1);
    },
  },
  {
    name: 'GRP-01: a display name the table refuses (blank after trimming, 41 characters, a control character in it) rejects the join and writes nothing, the invitation still unused; 40 characters join',
    async run(subject) {
      const { invitationCode } = await invited(subject);
      const first = await snapshot(subject);

      for (const displayName of ['   ', 'x'.repeat(41), 'Testmedlem\u0007Ø']) {
        await expect(
          subject.store.joinWithInvitation({
            invitationCode,
            joinKey: syntheticJoinKey(),
            displayName,
          }),
          JSON.stringify(displayName),
        ).rejects.toThrow();
        expect(await snapshot(subject), JSON.stringify(displayName)).toEqual(first);
      }

      const result = await subject.store.joinWithInvitation({
        invitationCode,
        joinKey: syntheticJoinKey(),
        displayName: 'x'.repeat(40),
      });
      expect(result.outcome).toBe('joined');
    },
  },
  {
    name: 'GRP-01-AC9: members lists every member with the name they gave and their role, and nobody else: not a user who is no member, not a removed member, not the canary’s users',
    async run(subject) {
      const admin = await joinedAdmin(subject);
      const { invitationCode } = created(
        await subject.store.createInvitation({ adminId: admin.userId }),
      );
      const member = {
        displayName: syntheticDisplayName(),
        joinKey: syntheticJoinKey(),
      };
      const { userId: memberId } = joined(
        await subject.store.joinWithInvitation({ invitationCode, ...member }),
      );
      const removed = await subject.addMember();
      await subject.addUser();
      await subject.store.registerCanary({ credentialHash: subject.hash(syntheticJoinKey()) });
      expect(
        await subject.store.removeMember({ adminId: admin.userId, memberId: removed }),
      ).toEqual({ outcome: 'removed' });

      const members = await subject.store.members();

      expect([...members].sort((a, b) => a.userId.localeCompare(b.userId))).toEqual(
        [
          { userId: admin.userId, displayName: admin.displayName, role: 'ADMIN' },
          { userId: memberId, displayName: member.displayName, role: 'MEMBER' },
        ].sort((a, b) => a.userId.localeCompare(b.userId)),
      );
      for (const canary of [CANARY_IDS.walkerId, CANARY_IDS.responderId]) {
        expect(await subject.store.memberOf(canary)).toBeNull();
      }
      expect(await subject.store.memberOf(removed)).toBeNull();
    },
  },
  {
    name: 'GRP-01-AC9: the tables refuse a second ADMIN in the group, and a second membership for one user',
    async run(subject) {
      const adminId = await subject.addMember({ role: 'ADMIN' });
      const first = await snapshot(subject);

      await expect(subject.addMember({ role: 'ADMIN' })).rejects.toThrow();
      await expect(subject.addMember({ id: adminId })).rejects.toThrow();
      expect((await snapshot(subject)).memberships).toEqual(first.memberships);
    },
  },
  {
    name: 'GRP-01-AC15: neither canary user is ever a member: a membership for either is refused by the table; joins and a bootstrap leave CANARY_DEVICE_ID with its user and hash; removing either is MEMBER_NOT_FOUND',
    async run(subject) {
      const hash = subject.hash(syntheticJoinKey());
      await subject.store.registerCanary({ credentialHash: hash });
      const canaryDevices = await subject.devicesOf(CANARY_IDS.walkerId);
      expect(canaryDevices).toEqual([{ id: CANARY_IDS.deviceId, credentialHash: hash }]);

      for (const id of [CANARY_IDS.walkerId, CANARY_IDS.responderId]) {
        await expect(subject.addMember({ id }), id).rejects.toThrow();
      }
      const admin = joined(
        await subject.store.bootstrapGroup({ displayName: syntheticDisplayName() }),
      );
      for (let i = 0; i < 3; i += 1) {
        const { invitationCode } = created(
          await subject.store.createInvitation({ adminId: admin.userId }),
        );
        joined(
          await subject.store.joinWithInvitation({
            invitationCode,
            joinKey: syntheticJoinKey(),
            displayName: syntheticDisplayName(),
          }),
        );
      }

      expect(await subject.devicesOf(CANARY_IDS.walkerId)).toEqual(canaryDevices);
      expect(await subject.devicesOf(CANARY_IDS.responderId)).toEqual([]);
      const memberIds = (await subject.membershipsAsStored()).map(({ userId }) => userId);
      expect(memberIds).not.toContain(CANARY_IDS.walkerId);
      expect(memberIds).not.toContain(CANARY_IDS.responderId);
      const first = await snapshot(subject);
      for (const memberId of [CANARY_IDS.walkerId, CANARY_IDS.responderId]) {
        expect(
          await subject.store.removeMember({ adminId: admin.userId, memberId }),
          memberId,
        ).toEqual({ outcome: 'not_removed', reason: 'MEMBER_NOT_FOUND' });
      }
      expect(await snapshot(subject)).toEqual(first);
    },
  },
  {
    name: 'GRP-01-AC14: the canary’s walker may name its own responder and nobody else, and no member may name either canary user: its start naming a member is refused INVALID_RESPONDER, naming its responder alone is stored',
    async run(subject) {
      await subject.store.registerCanary({ credentialHash: subject.hash(syntheticJoinKey()) });
      const [walker, member] = [await subject.addMember(), await subject.addMember()];
      const { walkerId, responderId, deviceId } = CANARY_IDS;

      expect([
        ...(await subject.store.eligibleResponders(walkerId, [responderId, member, walker])),
      ]).toEqual([responderId]);
      expect(
        [
          ...(await subject.store.eligibleResponders(walker, [walkerId, responderId, member])),
        ].sort(),
      ).toEqual([member]);

      expect(
        await subject.store.insertStarted({
          walkerId,
          deviceId,
          responderIds: [member],
          startedAt: await subject.now(),
        }),
      ).toEqual({ inserted: false, refused: 'INVALID_RESPONDER' });
      expect(
        await subject.store.insertStarted({
          walkerId,
          deviceId,
          responderIds: [responderId, member],
          startedAt: await subject.now(),
        }),
      ).toEqual({ inserted: false, refused: 'INVALID_RESPONDER' });
      const own = await subject.store.insertStarted({
        walkerId,
        deviceId,
        responderIds: [responderId],
        startedAt: await subject.now(),
      });
      expect(own.inserted).toBe(true);

      const { deviceId: walkersDevice } = await subject.addDevice(walker);
      expect(
        await subject.store.insertStarted({
          walkerId: walker,
          deviceId: walkersDevice,
          responderIds: [responderId],
          startedAt: await subject.now(),
        }),
      ).toEqual({ inserted: false, refused: 'INVALID_RESPONDER' });
    },
  },
  {
    name: 'GRP-01-AC11: authenticate admits a member’s device FULL and the canary’s device FULL, though its user is no member; a credential no device has, and a plain user’s device, nowhere',
    async run(subject) {
      const member = await subject.addMember();
      const own = await subject.addDevice(member);
      const plainUser = await subject.addUser();
      const plain = await subject.addDevice(plainUser);
      const canaryCredential = syntheticJoinKey();
      await subject.store.registerCanary({ credentialHash: subject.hash(canaryCredential) });

      expect(await subject.store.authenticate(own.credential)).toEqual({
        deviceId: own.deviceId,
        userId: member,
        access: 'FULL',
      });
      expect(await subject.store.authenticate(canaryCredential)).toEqual({
        deviceId: CANARY_IDS.deviceId,
        userId: CANARY_IDS.walkerId,
        access: 'FULL',
      });
      expect(await subject.store.authenticate(plain.credential)).toBeNull();
      expect(await subject.store.authenticate(syntheticJoinKey())).toBeNull();
      expect(await subject.store.authenticate('')).toBeNull();
    },
  },
  {
    name: 'GRP-01-AC11 and AC21: a removed member’s devices are admitted nowhere, but the device that started their unended journey is admitted WALKER_ONLY until that journey ends, and then nowhere',
    async run(subject) {
      const adminId = await subject.addMember({ role: 'ADMIN' });
      const walkerId = await subject.addMember();
      const responderId = await subject.addMember();
      const walk = await walking(subject, walkerId, [responderId]);
      const tablet = await subject.addDevice(walkerId);
      const idle = await subject.addMember();
      const idleDevice = await subject.addDevice(idle);

      for (const memberId of [walkerId, idle]) {
        expect(await subject.store.removeMember({ adminId, memberId }), memberId).toEqual({
          outcome: 'removed',
        });
      }

      expect(await subject.store.authenticate(walk.credential)).toEqual({
        deviceId: walk.deviceId,
        userId: walkerId,
        access: 'WALKER_ONLY',
      });
      expect(await subject.store.authenticate(tablet.credential)).toBeNull();
      expect(await subject.store.authenticate(idleDevice.credential)).toBeNull();

      expect(
        await subject.store.recordHome({
          journeyId: walk.journeyId,
          walkerId,
          deviceId: walk.deviceId,
        }),
      ).toMatchObject({ outcome: 'home' });
      expect(await subject.store.authenticate(walk.credential)).toBeNull();
    },
  },
  {
    name: 'GRP-01-AC16: removeMember refuses, writing nothing: NOT_THE_ADMIN for a member, a plain user or an ID that is no user; CANNOT_REMOVE_ADMIN for the admin removing themself; MEMBER_NOT_FOUND for a plain user, an ID that is no user, or a member removed already',
    async run(subject) {
      const adminId = await subject.addMember({ role: 'ADMIN' });
      const member = await subject.addMember();
      const other = await subject.addMember();
      const plainUser = await subject.addUser();
      await walking(subject, other, [member]);
      expect(await subject.store.removeMember({ adminId, memberId: other })).toEqual({
        outcome: 'removed',
      });
      const first = await snapshot(subject);
      const journeys = await subject.respondersOf(
        (await walking(subject, member, [adminId])).journeyId,
      );
      const withJourney = await snapshot(subject);

      const refusals: [string, string, RemoveMemberResult][] = [
        [member, adminId, { outcome: 'not_removed', reason: 'NOT_THE_ADMIN' }],
        [member, other, { outcome: 'not_removed', reason: 'NOT_THE_ADMIN' }],
        [plainUser, member, { outcome: 'not_removed', reason: 'NOT_THE_ADMIN' }],
        [syntheticUuid(), member, { outcome: 'not_removed', reason: 'NOT_THE_ADMIN' }],
        [adminId, adminId, { outcome: 'not_removed', reason: 'CANNOT_REMOVE_ADMIN' }],
        [adminId, plainUser, { outcome: 'not_removed', reason: 'MEMBER_NOT_FOUND' }],
        [adminId, syntheticUuid(), { outcome: 'not_removed', reason: 'MEMBER_NOT_FOUND' }],
        [adminId, other, { outcome: 'not_removed', reason: 'MEMBER_NOT_FOUND' }],
      ];
      for (const [caller, memberId, answer] of refusals) {
        expect(
          await subject.store.removeMember({ adminId: caller, memberId }),
          `${caller} removing ${memberId}`,
        ).toEqual(answer);
      }
      expect(await snapshot(subject)).toEqual(withJourney);
      expect(withJourney.audit).toBe(first.audit);
      expect(journeys).toEqual([adminId]);
    },
  },
  {
    name: 'GRP-01-AC17: removeMember removes, at once, the membership and the member’s responder rows on every unended journey, leaving an ended journey’s as they were, and writes one MEMBER_REMOVED audit row naming the admin and the member at the store’s now; both of the member’s devices are then admitted nowhere',
    async run(subject) {
      const adminId = await subject.addMember({ role: 'ADMIN' });
      const memberId = await subject.addMember();
      const keeper = await subject.addMember();
      const phone = await subject.addDevice(memberId);
      const tablet = await subject.addDevice(memberId);
      const j1 = await walking(subject, await subject.addMember(), [memberId, keeper]);
      const j2 = await walking(
        subject,
        await subject.addMember(),
        [keeper, memberId],
        'LOST_CONTACT',
      );
      const j0 = await walking(subject, await subject.addMember(), [memberId, keeper], 'ENDED');
      const audit = (await subject.auditAsStored()).length;
      const from = await subject.now();

      expect(await subject.store.removeMember({ adminId, memberId })).toEqual({
        outcome: 'removed',
      });

      const to = await subject.now();
      expect(await subject.store.memberOf(memberId)).toBeNull();
      expect((await subject.membershipsAsStored()).map(({ userId }) => userId)).not.toContain(
        memberId,
      );
      expect(await subject.respondersOf(j1.journeyId)).toEqual([keeper]);
      expect(await subject.respondersOf(j2.journeyId)).toEqual([keeper]);
      expect(await subject.respondersOf(j0.journeyId)).toEqual([memberId, keeper].sort());
      expect(await subject.stateOf(j1.journeyId)).toBe('ACTIVE');
      expect(await subject.stateOf(j2.journeyId)).toBe('LOST_CONTACT');
      const rows = await subject.auditAsStored();
      expect(rows).toHaveLength(audit + 1);
      const removal = rows.find(({ action }) => action === 'MEMBER_REMOVED');
      expect(removal).toEqual({
        at: expect.any(Date) as unknown,
        actorId: adminId,
        action: 'MEMBER_REMOVED',
        subjectId: memberId,
      });
      expect(within(removal?.at ?? new Date(Number.NaN), from, to)).toBe(true);
      expect(await subject.store.authenticate(phone.credential)).toBeNull();
      expect(await subject.store.authenticate(tablet.credential)).toBeNull();
    },
  },
  {
    name: 'GRP-01-AC18 and AC19: removeMember takes SM-10’s own step on each journey: the member’s unsent messages of the journey’s alerts withdrawn, an alert they acknowledged reset to OPEN with nobody recorded and its round raised, and the walker warned NO_RESPONDER where they were the last',
    async run(subject) {
      const adminId = await subject.addMember({ role: 'ADMIN' });
      const memberId = await subject.addMember();
      const keeper = await subject.addMember();
      const now = await subject.now();
      // J1: lost, the member's push unsent, the keeper's sent.
      const j1 = await walking(
        subject,
        await subject.addMember(),
        [memberId, keeper],
        'LOST_CONTACT',
      );
      const alert1 = await subject.seedAlert({
        journeyId: j1.journeyId,
        state: 'OPEN',
        openedAt: before(now, MINUTE),
        silentSince: before(now, 6 * MINUTE),
      });
      const unsent = await subject.seedMessage({
        alertId: alert1,
        recipientId: memberId,
        kind: 'LOST_CONTACT',
        createdAt: before(now, MINUTE),
        nextAttemptAt: before(now, MINUTE),
      });
      // J2: the member acknowledged its escalated alert.
      const j2 = await walking(
        subject,
        await subject.addMember(),
        [keeper, memberId],
        'LOST_CONTACT',
      );
      const alert2 = await subject.seedAlert({
        journeyId: j2.journeyId,
        state: 'ACKNOWLEDGED',
        openedAt: before(now, 4 * MINUTE),
        silentSince: before(now, 9 * MINUTE),
        acknowledgedBy: memberId,
        acknowledgedAt: before(now, MINUTE),
        smsRaisedAt: before(now, 2 * MINUTE),
      });
      // J3: the member was its only responder.
      const lonelyWalker = await subject.addMember();
      const j3 = await walking(subject, lonelyWalker, [memberId]);

      expect(await subject.store.removeMember({ adminId, memberId })).toEqual({
        outcome: 'removed',
      });

      const withdrawn = (await subject.messagesOf(j1.journeyId)).find(
        ({ messageId }) => messageId === unsent,
      );
      expect(withdrawn?.withdrawnAt).toEqual(expect.any(Date) as unknown);
      expect(await subject.alertsOf(j2.journeyId)).toEqual([
        { id: alert2, state: 'OPEN', acknowledgedBy: null, round: 2 },
      ]);
      expect(await subject.journeyMessagesOf(j3.journeyId)).toEqual([
        { recipientId: lonelyWalker, kind: 'NO_RESPONDER' },
      ]);
      expect(await subject.journeyMessagesOf(j1.journeyId)).toEqual([]);
      expect(await subject.respondersOf(j3.journeyId)).toEqual([]);
    },
  },
  {
    name: 'GRP-01-AC21: removeMember of a member who is walking leaves their own unended journey, its state and its responders as they were',
    async run(subject) {
      const adminId = await subject.addMember({ role: 'ADMIN' });
      const walkerId = await subject.addMember();
      const [r1, r2] = [await subject.addMember(), await subject.addMember()];
      const walk = await walking(subject, walkerId, [r1, r2], 'LOST_CONTACT');

      expect(await subject.store.removeMember({ adminId, memberId: walkerId })).toEqual({
        outcome: 'removed',
      });

      expect(await subject.stateOf(walk.journeyId)).toBe('LOST_CONTACT');
      expect(await subject.respondersOf(walk.journeyId)).toEqual([r1, r2].sort());
      expect(await subject.journeyMessagesOf(walk.journeyId)).toEqual([]);
    },
  },
  {
    name: 'GRP-01-AC20: removeMember with one of the member’s journey rows held past the lock limit rejects and writes nothing, the member still a member and on both journeys and no audit row written; once the row is free, the same removal completes',
    async run(subject) {
      const adminId = await subject.addMember({ role: 'ADMIN' });
      const memberId = await subject.addMember();
      const j1 = await walking(subject, await subject.addMember(), [memberId]);
      const j2 = await walking(subject, await subject.addMember(), [memberId]);
      const held = await subject.hold([j1.journeyId, j2.journeyId].sort()[1] ?? '');
      const first = await snapshot(subject);

      try {
        await expect(subject.store.removeMember({ adminId, memberId })).rejects.toThrow();
        expect(await snapshot(subject)).toEqual(first);
        expect(await subject.respondersOf(j1.journeyId)).toEqual([memberId]);
        expect(await subject.respondersOf(j2.journeyId)).toEqual([memberId]);
        expect(await subject.journeyMessagesOf(j1.journeyId)).toEqual([]);
        expect(await subject.journeyMessagesOf(j2.journeyId)).toEqual([]);
      } finally {
        await held.release();
      }

      expect(await subject.store.removeMember({ adminId, memberId })).toEqual({
        outcome: 'removed',
      });
      expect(await subject.respondersOf(j1.journeyId)).toEqual([]);
      expect(await subject.respondersOf(j2.journeyId)).toEqual([]);
    },
  },
  {
    name: 'GRP-01-AC13: a start whose named member was removed after the module’s read is refused under the lock, INVALID_RESPONDER, and stores nothing; one naming members still there is stored',
    async run(subject) {
      const walkerId = await subject.addMember();
      const [gone, kept] = [await subject.addMember(), await subject.addMember()];
      const { deviceId } = await subject.addDevice(walkerId);
      expect([...(await subject.store.eligibleResponders(walkerId, [gone, kept]))].sort()).toEqual(
        [gone, kept].sort(),
      );

      await subject.removeMembershipRow(gone);

      expect(
        await subject.store.insertStarted({
          walkerId,
          deviceId,
          responderIds: [kept, gone],
          startedAt: await subject.now(),
        }),
      ).toEqual({ inserted: false, refused: 'INVALID_RESPONDER' });
      expect(
        (
          await subject.store.insertStarted({
            walkerId,
            deviceId,
            responderIds: [kept],
            startedAt: await subject.now(),
          })
        ).inserted,
      ).toBe(true);
    },
  },
];

/** The first admin, by the bootstrap: their ID, name and credential. */
async function joinedAdmin(subject: GroupStoreUnderTest) {
  const displayName = syntheticDisplayName();
  return { displayName, ...joined(await subject.store.bootstrapGroup({ displayName })) };
}
