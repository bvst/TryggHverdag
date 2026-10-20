// req-coverage: fixtures-only — this tests the test kit, not a requirement.
//
// GRP-01's system tests prove joining, inviting and removing by what the
// journey fake keeps of the group: its members, invitations, devices and
// audit rows. A fake that let a used invitation in twice, kept a code in
// clear, admitted a removed member's phone, or removed a member from half
// their journeys would make those tests pass whatever the server did. The
// shared behaviour suite below is the one the real adapters run against
// PostgreSQL (adapters/groups.integration.test.ts), so the two cannot drift
// apart (D-100). Each behaviour gets a fresh fake: the bootstrap's need a
// store with no group in it.
import { describe, expect, test } from 'vitest';
import { CANARY_IDS } from './canary-ids.ts';
import { fakeClock } from './fake-clock.ts';
import { fakeJourneyStore } from './fake-journey-store.ts';
import { GROUP_STORE_BEHAVIOUR, type GroupStoreUnderTest } from './group-store-behaviour.ts';
import * as kit from './index.ts';
import { sha256Hex } from './sha256.ts';
import {
  syntheticDisplayName,
  syntheticInvitationCode,
  syntheticJoinKey,
} from './synthetic-groups.ts';
import { syntheticUuid } from './synthetic-ids.ts';

/** A synthetic night, where the fake's clock stands. */
const AT = new Date('2026-10-20T21:00:00.000Z');

function underTest(): GroupStoreUnderTest {
  const clock = fakeClock(AT);
  const store = fakeJourneyStore({ clock });
  const journey = (journeyId: string) =>
    store.journeys().find(({ id }) => id === journeyId.toLowerCase());
  const alertsOf = (journeyId: string) =>
    store.alerts().filter((alert) => alert.journeyId === journeyId.toLowerCase());
  return {
    store,
    now: () => clock.now(),
    timeMarginMs: 0,
    hash: sha256Hex,
    addUser: () => Promise.resolve(store.addUser()),
    // A refusal is a rejection, as the database's is, not a throw.
    addMember: ({ role, id } = {}) =>
      new Promise<string>((resolve) => {
        resolve(store.addMember(id, role === undefined ? {} : { role }));
      }),
    addDevice: (userId) => Promise.resolve(store.addDeviceWithCredential(userId)),
    seedInvitation: async ({ createdBy, createdAgoMs, used = null }) => {
      const now = await clock.now();
      return store.seedInvitation({
        createdBy,
        createdAt: new Date(now.getTime() - createdAgoMs),
        used: used === null ? null : { at: now, by: used.by, joinKey: used.joinKey },
      });
    },
    seedJourney: (seeded) => Promise.resolve(store.seed(seeded)),
    seedAlert: (alert) => Promise.resolve(store.seedAlert(alert)),
    seedMessage: (message) => Promise.resolve(store.seedMessage(message)),
    respondersOf: (journeyId) =>
      Promise.resolve([...(journey(journeyId)?.responderIds ?? [])].sort()),
    stateOf: (journeyId) => Promise.resolve(journey(journeyId)?.state ?? null),
    alertsOf: (journeyId) => {
      const rounds = new Map(store.alertRounds().map(({ alertId, round }) => [alertId, round]));
      return Promise.resolve(
        alertsOf(journeyId).map(({ id, state, acknowledgedBy }) => ({
          id,
          state,
          acknowledgedBy,
          round: rounds.get(id) ?? 0,
        })),
      );
    },
    messagesOf: (journeyId) => {
      const ids = new Set(alertsOf(journeyId).map(({ id }) => id));
      return Promise.resolve(
        store
          .outbox()
          .filter(({ alertId }) => ids.has(alertId))
          .map(({ messageId, recipientId, kind, withdrawnAt }) => ({
            messageId,
            recipientId,
            kind,
            withdrawnAt,
          })),
      );
    },
    journeyMessagesOf: (journeyId) =>
      Promise.resolve(
        store
          .journeyMessages()
          .filter((message) => message.journeyId === journeyId.toLowerCase())
          .map(({ recipientId, kind }) => ({ recipientId, kind })),
      ),
    groupsAsStored: () => Promise.resolve(store.groups().map(({ id }) => ({ id }))),
    membershipsAsStored: () =>
      Promise.resolve(
        store.memberships().map(({ userId, groupId, role, displayName }) => ({
          userId,
          groupId,
          role,
          displayName,
        })),
      ),
    invitationsAsStored: () => Promise.resolve(store.invitations()),
    auditAsStored: () =>
      Promise.resolve(
        store
          .auditLog()
          .map(({ at, actorId, action, subjectId }) => ({ at, actorId, action, subjectId })),
      ),
    devicesOf: (userId) =>
      Promise.resolve(
        store
          .devices()
          .filter((device) => device.userId === userId.toLowerCase())
          .map(({ id, credentialHash }) => ({ id, credentialHash })),
      ),
    userCount: () => Promise.resolve(store.userIds().length),
    deviceCount: () => Promise.resolve(store.devices().length),
    hold: (journeyId) => {
      store.hold(journeyId);
      return Promise.resolve({
        release: () => {
          store.release(journeyId);
          return Promise.resolve();
        },
      });
    },
    removeMembershipRow: (userId) => {
      store.removeMembership(userId);
      return Promise.resolve();
    },
  };
}

describe('fakeJourneyStore, against the behaviour every group store shares (GRP-01, D-100)', () => {
  test('the shared suite is the list the adapter runs too; a case removed shows here', () => {
    expect(GROUP_STORE_BEHAVIOUR.map((behaviour) => behaviour.name)).toEqual([
      'GRP-01-AC8: bootstrapGroup on an empty store makes, at once, the group, its ADMIN with the name given, one device holding only the SHA-256 of a fresh 43-character credential, and one GROUP_CREATED audit row naming the admin; the credential authenticates FULL',
      // RG-03 (GRP-01-AC8, review loop 1): this behaviour's name narrows to
      // "with another join key", since the same key while the admin is the
      // only member is now the bootstrap retried; its checks are unchanged.
      // The two behaviours after the race are added: the retry, and its
      // window closing once a second member has joined.
      'GRP-01-AC2 and AC8: once a group exists, bootstrapGroup with another join key is not_valid and writes nothing: no second group, admin, user, device or audit row, whether the group came from a bootstrap or not',
      'GRP-01-AC8: bootstraps racing on an empty store leave exactly one group and one admin: one is joined, every other not_valid',
      'GRP-01-AC8: bootstrapGroup sent again with the same join key, while the admin is the group’s only member, is the same bootstrap retried: the same user, ADMIN, a new credential; the admin’s one device now holds its SHA-256 and the first credential authenticates nowhere; still one group, membership, user, device and GROUP_CREATED row, and the name is the first one’s',
      'GRP-01-AC8: the bootstrap retried with the same join key once a second member has joined is not_valid and writes nothing; the admin’s credential still authenticates',
      'GRP-01-AC1: the admin’s createInvitation is created: a code of 20 of Crockford’s characters, expiring exactly seven days after it was made at the store’s now; only the code’s SHA-256 is stored, with its maker; and one INVITATION_CREATED audit row names the admin and the invitation',
      'GRP-01-AC9: createInvitation by a member who is not the admin, by a user who is no member, or by an ID that is no user is not_the_admin, and writes nothing',
      'GRP-01-AC3: an unused invitation brings in one member: joined MEMBER with a new user, the name given, one device holding only the SHA-256 of a fresh 43-character credential; the invitation used at the store’s now, by that user, with the join key’s SHA-256; the credential authenticates FULL',
      'GRP-01-AC2: a code no invitation has, of the right shape, is not_valid, and writes nothing',
      'GRP-01-AC2 and AC4: a used invitation sent with another join key is not_valid, and writes nothing',
      'GRP-01-AC5: the same code sent again with the same join key is the same join retried: the same user and role, a new credential, the same one device now holding the new credential’s SHA-256; the first credential authenticates nowhere; still one user, membership and device',
      'GRP-01-AC5: the same code with the same join key is not_valid, writing nothing, once its user has been removed, and once the invitation has expired',
      'GRP-01-AC6: an invitation is valid until seven days after it was made, by the store’s clock, and expired from that very moment: made seven days ago it is not_valid and writes nothing; made a moment less than seven days ago, it joins',
      'GRP-01-AC4: joins racing with one invitation and different join keys: exactly one is joined, every other not_valid; one user, one membership and one device come of it',
      'GRP-01: a display name the table refuses (blank after trimming, 41 characters, a control character in it) rejects the join and writes nothing, the invitation still unused; 40 characters join',
      'GRP-01-AC9: members lists every member with the name they gave and their role, and nobody else: not a user who is no member, not a removed member, not the canary’s users',
      'GRP-01-AC9: the tables refuse a second ADMIN in the group, and a second membership for one user',
      'GRP-01-AC15: neither canary user is ever a member: a membership for either is refused by the table; joins and a bootstrap leave CANARY_DEVICE_ID with its user and hash; removing either is MEMBER_NOT_FOUND',
      'GRP-01-AC14: the canary’s walker may name its own responder and nobody else, and no member may name either canary user: its start naming a member is refused INVALID_RESPONDER, naming its responder alone is stored',
      'GRP-01-AC11: authenticate admits a member’s device FULL and the canary’s device FULL, though its user is no member; a credential no device has, and a plain user’s device, nowhere',
      'GRP-01-AC11 and AC21: a removed member’s devices are admitted nowhere, but the device that started their unended journey is admitted WALKER_ONLY until that journey ends, and then nowhere',
      'GRP-01-AC16: removeMember refuses, writing nothing: NOT_THE_ADMIN for a member, a plain user or an ID that is no user; CANNOT_REMOVE_ADMIN for the admin removing themself; MEMBER_NOT_FOUND for a plain user, an ID that is no user, or a member removed already',
      'GRP-01-AC17: removeMember removes, at once, the membership and the member’s responder rows on every unended journey, leaving an ended journey’s as they were, and writes one MEMBER_REMOVED audit row naming the admin and the member at the store’s now; both of the member’s devices are then admitted nowhere',
      'GRP-01-AC18 and AC19: removeMember takes SM-10’s own step on each journey: the member’s unsent messages of the journey’s alerts withdrawn, an alert they acknowledged reset to OPEN with nobody recorded and its round raised, and the walker warned NO_RESPONDER where they were the last',
      'GRP-01-AC21: removeMember of a member who is walking leaves their own unended journey, its state and its responders as they were',
      'GRP-01-AC20: removeMember with one of the member’s journey rows held past the lock limit rejects and writes nothing, the member still a member and on both journeys and no audit row written; once the row is free, the same removal completes',
      'GRP-01-AC13: a start whose named member was removed after the module’s read is refused under the lock, INVALID_RESPONDER, and stores nothing; one naming members still there is stored',
    ]);
    expect(kit.GROUP_STORE_BEHAVIOUR).toBe(GROUP_STORE_BEHAVIOUR);
  });

  test.each(GROUP_STORE_BEHAVIOUR)('$name', async ({ run }) => {
    await run(underTest());
  });
});

describe('fakeJourneyStore: the group, beyond the shared suite (GRP-01)', () => {
  test('every group port method answers a turn later and is recorded; while failing it rejects with exactly the error given and changes nothing', async () => {
    const store = fakeJourneyStore({ clock: fakeClock(AT) });
    const adminId = store.addMember(undefined, { role: 'ADMIN' });
    const error = new Error('the database did not answer');
    store.failWith(error);

    await expect(store.authenticate(syntheticJoinKey())).rejects.toBe(error);
    await expect(store.bootstrapGroup({ displayName: syntheticDisplayName() })).rejects.toBe(error);
    await expect(
      store.joinWithInvitation({
        invitationCode: syntheticInvitationCode(),
        joinKey: syntheticJoinKey(),
        displayName: syntheticDisplayName(),
      }),
    ).rejects.toBe(error);
    await expect(store.memberOf(adminId)).rejects.toBe(error);
    await expect(store.members()).rejects.toBe(error);
    await expect(store.createInvitation({ adminId })).rejects.toBe(error);
    await expect(store.removeMember({ adminId, memberId: syntheticUuid() })).rejects.toBe(error);

    expect(store.calls).toEqual([
      'authenticate',
      'bootstrapGroup',
      'joinWithInvitation',
      'memberOf',
      'members',
      'createInvitation',
      'removeMember',
    ]);
    expect(store.invitations()).toEqual([]);
    expect(store.auditLog()).toEqual([]);
    expect(store.memberships()).toHaveLength(1);
  });

  test('without a clock, a bootstrap, an invitation, a join and a removal each refuse loudly rather than guess the time', async () => {
    const store = fakeJourneyStore();
    const adminId = store.addMember(undefined, { role: 'ADMIN' });
    const memberId = store.addMember();

    await expect(store.createInvitation({ adminId })).rejects.toThrow(/no clock/);
    await expect(store.removeMember({ adminId, memberId })).rejects.toThrow(/no clock/);
    await expect(
      fakeJourneyStore().bootstrapGroup({ displayName: syntheticDisplayName() }),
    ).rejects.toThrow(/no clock/);
    expect(store.memberships()).toHaveLength(2);
  });

  // The fake's own corner of the bootstrap retry (GRP-01-AC8, review loop 1),
  // which the shared suite cannot reach: the port takes a join key, but a
  // caller may send none, as the join module did before review loop 1. Such a
  // bootstrap keeps no key, so nothing can retry it; nor can a group a
  // builder put in, which has no first admin's key either.
  test('a bootstrap sent with no join key, and a group a builder put in, can never be retried: every later bootstrap is not_valid and writes nothing', async () => {
    const bootstrapped = fakeJourneyStore({ clock: fakeClock(AT) });
    const first = await bootstrapped.bootstrapGroup({ displayName: syntheticDisplayName() });
    expect(first).toMatchObject({ outcome: 'joined', role: 'ADMIN' });
    const devices = bootstrapped.devices();

    expect(await bootstrapped.bootstrapGroup({ displayName: syntheticDisplayName() })).toEqual({
      outcome: 'not_valid',
    });
    expect(
      await bootstrapped.bootstrapGroup({
        joinKey: syntheticJoinKey(),
        displayName: syntheticDisplayName(),
      }),
    ).toEqual({ outcome: 'not_valid' });
    expect(bootstrapped.devices()).toEqual(devices);

    const built = fakeJourneyStore({ clock: fakeClock(AT) });
    built.addMember(undefined, { role: 'ADMIN' });
    expect(
      await built.bootstrapGroup({
        joinKey: syntheticJoinKey(),
        displayName: syntheticDisplayName(),
      }),
    ).toEqual({ outcome: 'not_valid' });
    expect(built.groups()).toHaveLength(1);
    expect(built.auditLog()).toEqual([]);
  });

  test('a canary user is no member: addMember refuses either, as the table’s check does, and the canary’s walker names its own responder alone', async () => {
    const store = fakeJourneyStore({ clock: fakeClock(AT) });

    expect(() => store.addMember(CANARY_IDS.walkerId)).toThrow(/check constraint/);
    expect(() => store.addMember(CANARY_IDS.responderId)).toThrow(/check constraint/);
    expect(store.memberships()).toEqual([]);
    expect([
      ...(await store.eligibleResponders(CANARY_IDS.walkerId, [CANARY_IDS.responderId])),
    ]).toEqual([CANARY_IDS.responderId]);
  });

  test('a device’s admission is read at each check: a member’s phone is FULL, then nowhere once the membership row is gone', async () => {
    const store = fakeJourneyStore({ clock: fakeClock(AT) });
    const memberId = store.addMember();
    const { deviceId, credential } = store.addDeviceWithCredential(memberId);

    await expect(store.authenticate(credential)).resolves.toEqual({
      deviceId,
      userId: memberId,
      access: 'FULL',
    });
    store.removeMembership(memberId);
    await expect(store.authenticate(credential)).resolves.toBeNull();
    expect(store.deviceWithCredentialHash(sha256Hex(credential))).toBeNull();
  });

  test('the test kit hands out the group suite and the synthetic group data', () => {
    expect(typeof kit.syntheticDisplayName).toBe('function');
    expect(typeof kit.syntheticInvitationCode).toBe('function');
    expect(typeof kit.syntheticJoinKey).toBe('function');
    expect(typeof kit.syntheticBootstrapCode).toBe('function');
    expect(typeof kit.sha256Hex).toBe('function');
    expect(kit.syntheticInvitationCode()).toMatch(kit.INVITATION_CODE);
    expect(kit.syntheticBootstrapCode()).toMatch(/^[0-9A-F]{32}$/);
    expect(kit.syntheticJoinKey()).toMatch(kit.BASE64URL_43);
    expect(kit.inGroupsOfFive('ABCDEFGHJKMNPQRSTVWX')).toBe('ABCDE-FGHJK-MNPQR-STVWX');
    expect(kit.inGroupsOfFive('ABCDEFGHJKMNPQRSTVWX')).toMatch(kit.SHOWN_INVITATION_CODE);
  });
});
