// L6 system: joining by invitation, the admin who invites and removes, the
// sessions that membership is, and the route that removes a responder from a
// journey (GRP-01), through the whole server in one process.
//
// The real API, the real contract, the real group modules (join, invitations,
// members), the real journey, acknowledgement, closure and removal modules,
// the real watchdog, push sender, SMS sender and SMS check, with fakes only at
// the edges: the journey fake, which since GRP-01 keeps the group, its
// members, invitations, devices and audit rows as the tables do and answers
// as the device authenticator does (approach item 5), the worker's beats, the
// push port, the SMS port, the SMS check's monitor and the log. One fake clock
// stands in for the database's now(). No module reads a clock (AR-03). The
// loops are run here as the worker runs them, every 10 s (D-107).
//
// What is proven here, criterion by criterion, through HTTP as a phone would
// call it: AC1 to AC3, AC5, AC8 to AC14, AC16 to AC19, AC21 to AC23, and the
// part of AC24 a fake can show (no refusal writes a line; nothing secret or
// personal in what the API writes). L3 proves the tables, the races and the
// database's clock (groups.integration.test.ts, and the shared group suite).
//
// Times are written out (five minutes, two minutes, seven days, 10 s), not
// read from the domain's constants, so a wrong constant fails here as well.
import { API_PREFIX, openApiDocument } from '@trygghverdag/contracts';
import {
  BASE64URL_43,
  CANARY_IDS,
  SHOWN_INVITATION_CODE,
  apiPath,
  fakeClock,
  fakeJourneyStore,
  fakeLog,
  fakePush,
  fakeSms,
  fakeSmsAlarm,
  fakeWorkerHeartbeats,
  sha256Hex,
  syntheticBootstrapCode,
  syntheticCredential,
  syntheticDisplayName,
  syntheticHeartbeat,
  syntheticInvitationCode,
  syntheticJoinKey,
  syntheticUuid,
  type FakeJourneyState,
} from '@trygghverdag/test-kit';
import { describe, expect, test } from 'vitest';
import { createApi } from './api.ts';
import { captured, markersIn } from './capture.test.ts';
import { createLog } from './log.ts';
import { createAcknowledgementService } from './modules/alerts/acknowledgement.ts';
import { createClosureService } from './modules/alerts/closure.ts';
import { createPushSender, createSmsSender } from './modules/alerts/outbox.ts';
import { createSmsCheck } from './modules/alerts/sms-check.ts';
import { createWatchdog } from './modules/alerts/watchdog.ts';
import { createInvitationService } from './modules/groups/invitations.ts';
import { createJoinService } from './modules/groups/join.ts';
import { createMemberService } from './modules/groups/members.ts';
import { createHealthService } from './modules/health/service.ts';
import { createRemovalService } from './modules/journeys/removal.ts';
import { createJourneyService } from './modules/journeys/service.ts';
import type { Log } from './ports.ts';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Reading 4: an invitation is valid for seven days, and not a moment longer. */
const SEVEN_DAYS = 7 * DAY;
/** D-021: responders are alerted when the server has heard nothing for five minutes. */
const FIVE_MINUTES = 5 * MINUTE;
/** D-019: every responder gets an SMS when nobody has acknowledged within two minutes. */
const TWO_MINUTES = 2 * MINUTE;
/** How often the worker's loops run (D-107). */
const INTERVAL = 10 * SECOND;

/** A synthetic night: 21:00 UTC on 20 October 2026. */
const START = new Date('2026-10-20T21:00:00.000Z');

const JOIN = apiPath('group/members');
const ME = apiPath('me');
const INVITATIONS = apiPath('group/invitations');
const MEMBERS = apiPath('group/members');
const JOURNEYS = apiPath('journeys');
const HEARTBEATS = apiPath('heartbeats');

/** The routes anyone may call without a device credential (AC10): health, and the join. */
const PUBLIC_ROUTES = ['GET /v1/health', 'POST /v1/group/members'];

/** An answer as these tests read it: its status, its body parsed, its text and its headers. */
interface Answer {
  status: number;
  body: unknown;
  text: string;
  headers: Headers;
}

function parsedOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function answerOf(response: Response): Promise<Answer> {
  const text = await response.text();
  return { status: response.status, body: parsedOrNull(text), text, headers: response.headers };
}

/** The error code an answer carries, if any. */
const codeOf = (answer: Answer): unknown => (answer.body as { code?: unknown } | null)?.code;

/** A phone: who it signs in as, its credential, and the join key it made. */
interface Phone {
  userId: string;
  credential: string;
  joinKey: string;
  displayName: string;
}

/**
 * One server, its fakes, and the people a test needs. `bootstrapCode` is the
 * API's ADMIN_BOOTSTRAP_CODE as config.ts hands it over, normalised; null
 * when it is unset or unusable.
 */
function world({
  bootstrapCode = syntheticBootstrapCode(),
  log: given,
}: { bootstrapCode?: string | null; log?: Log } = {}) {
  const clock = fakeClock(START);
  const store = fakeJourneyStore({ clock });
  const recorded = fakeLog();
  const log = given ?? recorded;
  const beats = fakeWorkerHeartbeats();
  const push = fakePush();
  const sms = fakeSms();
  const alarm = fakeSmsAlarm();
  const api = createApi({
    health: createHealthService({ clock, heartbeats: beats }),
    journeys: createJourneyService({ clock, journeys: store, log }),
    // GRP-01 (approach item 5): the store answers who a credential is, and how
    // far it is admitted, as the adapter's one query does; so membership is
    // the session here as there.
    devices: store,
    acknowledgements: createAcknowledgementService({ alerts: store, log }),
    closures: createClosureService({ alerts: store, log }),
    joins: createJoinService({ groups: store, log, bootstrapCode }),
    invitations: createInvitationService({ groups: store, log }),
    members: createMemberService({ groups: store, log }),
    removals: createRemovalService({ journeys: store, log }),
  });
  const watchdog = createWatchdog({ journeys: store, beats, log });
  const sender = createPushSender({ outbox: store, push, log });
  const smsSender = createSmsSender({ outbox: store, sms, log });
  const smsCheck = createSmsCheck({ outbox: store, alarm, log });

  const call = async (
    method: string,
    path: string,
    { credential, body }: { credential?: string; body?: unknown } = {},
  ): Promise<Answer> => {
    const headers: Record<string, string> = {};
    if (credential !== undefined) {
      headers['authorization'] = `Bearer ${credential}`;
    }
    if (body === undefined) {
      return answerOf(await api.request(path, { method, headers }));
    }
    headers['content-type'] = 'application/json';
    return answerOf(await api.request(path, { method, headers, body: JSON.stringify(body) }));
  };

  const self = {
    api,
    clock,
    store,
    push,
    sms,
    alarm,
    watchdog,
    smsCheck,
    /** What the modules logged, unless they were handed another log. */
    log: recorded,
    bootstrapCode,
    call,
    /** POST /v1/group/members, with no credential: the public join (approach item 4). */
    join: (body: unknown) => call('POST', JOIN, { body }),
    /** A phone that joins with this code: its own join key and a name typed. */
    async joinWith(invitationCode: string): Promise<Phone> {
      const joinKey = syntheticJoinKey();
      const displayName = syntheticDisplayName();
      const answer = await self.join({ invitationCode, joinKey, displayName });
      expect(answer.status, `the join: ${answer.text}`).toBe(201);
      const { userId, credential } = answer.body as { userId: string; credential: string };
      return { userId, credential, joinKey, displayName };
    },
    /** The first admin, joined with the bootstrap code (approach item 8). */
    async admin(): Promise<Phone> {
      if (bootstrapCode === null) {
        throw new Error('this world has no bootstrap code, so it has no first admin');
      }
      return self.joinWith(bootstrapCode);
    },
    /** POST /v1/group/invitations as this phone. */
    invite: (phone: { credential: string }) =>
      call('POST', INVITATIONS, { credential: phone.credential, body: {} }),
    /** An invitation of the admin's, as the API shows its code. */
    async invitation(admin: Phone): Promise<string> {
      const answer = await self.invite(admin);
      expect(answer.status, `the invitation: ${answer.text}`).toBe(201);
      return (answer.body as { invitationCode: string }).invitationCode;
    },
    /** A member, invited by the admin and joined through the API. */
    async member(admin: Phone): Promise<Phone> {
      return self.joinWith(await self.invitation(admin));
    },
    me: (phone: { credential: string }) => call('GET', ME, { credential: phone.credential }),
    members: (phone: { credential: string }) =>
      call('GET', MEMBERS, { credential: phone.credential }),
    /** DELETE /v1/group/members/{userId}: the admin's removal of a member. */
    removeMember: (phone: { credential: string }, userId: string) =>
      call('DELETE', `${MEMBERS}/${userId}`, { credential: phone.credential }),
    /** DELETE /v1/journeys/{journeyId}/responders/{responderId}: the walker's removal of a responder. */
    removeResponder: (phone: { credential: string }, journeyId: string, responderId: string) =>
      call('DELETE', `${JOURNEYS}/${journeyId}/responders/${responderId}`, {
        credential: phone.credential,
      }),
    start: (phone: { credential: string }, responderIds: readonly string[]) =>
      call('POST', JOURNEYS, { credential: phone.credential, body: { responderIds } }),
    /** Starts a journey, which must be 201; resolves to its ID. */
    async started(phone: { credential: string }, responderIds: readonly string[]): Promise<string> {
      const answer = await self.start(phone, responderIds);
      expect(answer.status, `the start: ${answer.text}`).toBe(201);
      return (answer.body as { journeyId: string }).journeyId;
    },
    heartbeat: (phone: { credential: string }, journeyId: string) =>
      call('POST', HEARTBEATS, {
        credential: phone.credential,
        body: syntheticHeartbeat({ journeyId }),
      }),
    home: (phone: { credential: string }, journeyId: string) =>
      call('POST', `${JOURNEYS}/${journeyId}/home`, { credential: phone.credential }),
    acknowledge: (phone: { credential: string }, alertId: string) =>
      call('POST', apiPath(`alerts/${alertId}/acknowledgement`), { credential: phone.credential }),
    /** One run of each loop, as the worker makes them: a sweep, a push delivery, an SMS delivery. */
    async runLoops() {
      const swept = await watchdog.sweep();
      await sender.deliverDue();
      await smsSender.deliverDue();
      return swept;
    },
    /** Moves the clock to exactly `at`, running the loops every 10 s on the way, as the worker would. */
    async runUntil(at: number) {
      for (;;) {
        const now = (await clock.now()).getTime();
        const step = Math.min(INTERVAL, at - now);
        if (step <= 0) {
          return;
        }
        clock.advance(step);
        await self.runLoops();
      }
    },
    respondersOf: (journeyId: string) =>
      [...(store.journeys().find(({ id }) => id === journeyId)?.responderIds ?? [])].sort(),
    stateOf: (journeyId: string) => store.journeys().find(({ id }) => id === journeyId)?.state,
    alertsOf: (journeyId: string) =>
      store.alerts().filter((alert) => alert.journeyId === journeyId),
    messagesOf(journeyId: string) {
      const ids = self.alertsOf(journeyId).map(({ id }) => id);
      return store.outbox().filter(({ alertId }) => ids.includes(alertId));
    },
    warningsOf: (journeyId: string) =>
      store.journeyMessages().filter((message) => message.journeyId === journeyId),
    roundOf: (alertId: string) =>
      store.alertRounds().find((alert) => alert.alertId === alertId)?.round,
    /** Everything a refusal must leave as it was. */
    snapshot: () => ({
      users: store.userIds().length,
      devices: store.devices(),
      groups: store.groups(),
      memberships: store.memberships(),
      invitations: store.invitations(),
      audit: store.auditLog(),
      journeys: store.journeys(),
      outbox: store.outbox(),
      warnings: store.journeyMessages(),
    }),
    /** A journey put in directly, with its silence begun `silentForMs` before the clock's now. */
    async seed(
      walker: Phone,
      responderIds: readonly string[],
      {
        state = 'ACTIVE',
        silentForMs = MINUTE,
      }: { state?: FakeJourneyState; silentForMs?: number } = {},
    ): Promise<string> {
      const silentSince = new Date((await clock.now()).getTime() - silentForMs);
      const deviceId = store.devices().find((device) => device.userId === walker.userId)?.id ?? '';
      return store.seed({
        walkerId: walker.userId,
        deviceId,
        state,
        responderIds,
        startedAt: new Date(silentSince.getTime() - HOUR),
        lastHeartbeatAt: silentSince,
      });
    },
  };
  return self;
}

type World = ReturnType<typeof world>;

/** The fixed 400, as any route answers it: read from a heartbeat that is not one. */
async function fixed400(w: World, phone: Phone): Promise<string> {
  const answer = await w.call('POST', HEARTBEATS, {
    credential: phone.credential,
    body: { not: 'a heartbeat' },
  });
  expect(answer.status).toBe(400);
  return answer.text;
}

/** The 401 an unknown credential gets: the one answer for every cause (SM-01-AC9). */
async function unknown401(w: World): Promise<string> {
  const answer = await w.call('GET', ME, { credential: syntheticCredential() });
  expect(answer.status).toBe(401);
  return answer.text;
}

// ---------------------------------------------------------------------------
// Invitations (AC1, AC2, AC3, AC5, AC6's L6 half, AC8, AC9).
// ---------------------------------------------------------------------------

describe('GRP-01: the first admin, by the bootstrap code', () => {
  test('GRP-01-AC8: on an empty store, a phone that joins with the bootstrap code is 201, ADMIN, with a credential; one group, one admin membership with the name typed, one device holding only the credential’s SHA-256, and one GROUP_CREATED audit row naming the admin', async () => {
    const w = world();
    const joinKey = syntheticJoinKey();
    const displayName = syntheticDisplayName();

    const answer = await w.join({ invitationCode: w.bootstrapCode, joinKey, displayName });

    expect(answer.status).toBe(201);
    expect(answer.body).toEqual({
      credential: expect.stringMatching(BASE64URL_43) as unknown,
      userId: expect.any(String) as unknown,
      role: 'ADMIN',
    });
    expect(answer.headers.get('cache-control')).toBe('no-store');
    const { userId, credential } = answer.body as { userId: string; credential: string };
    expect(w.store.groups()).toHaveLength(1);
    expect(w.store.memberships()).toEqual([
      expect.objectContaining({ userId, role: 'ADMIN', displayName }) as unknown,
    ]);
    expect(w.store.devices()).toEqual([
      { id: expect.any(String) as unknown, userId, credentialHash: sha256Hex(credential) },
    ]);
    expect(w.store.auditLog()).toEqual([
      expect.objectContaining({ action: 'GROUP_CREATED', actorId: userId }) as unknown,
    ]);
    expect((await w.me({ credential })).body).toEqual({ userId, displayName, role: 'ADMIN' });
  });

  test('GRP-01-AC8: the bootstrap code is read as a typed code is: in lower case, in groups, with hyphens and spaces', async () => {
    const w = world();
    const code = w.bootstrapCode ?? '';
    const typed = ` ${code.slice(0, 8).toLowerCase()}-${code.slice(8, 16)} ${code.slice(16).toLowerCase()} `;

    const answer = await w.join({
      invitationCode: typed,
      joinKey: syntheticJoinKey(),
      displayName: syntheticDisplayName(),
    });

    expect(answer.status, answer.text).toBe(201);
    expect((answer.body as { role: string }).role).toBe('ADMIN');
  });

  test('GRP-01-AC8 and AC2: once a group exists, the bootstrap code is the one 404 INVITATION_NOT_VALID, the same body as a code that never existed, and a second phone writes nothing: one group, one admin', async () => {
    const w = world();
    await w.admin();
    const before = w.snapshot();

    const again = await w.join({
      invitationCode: w.bootstrapCode,
      joinKey: syntheticJoinKey(),
      displayName: syntheticDisplayName(),
    });
    const never = await w.join({
      invitationCode: syntheticInvitationCode(),
      joinKey: syntheticJoinKey(),
      displayName: syntheticDisplayName(),
    });

    expect(again.status).toBe(404);
    expect(codeOf(again)).toBe('INVITATION_NOT_VALID');
    expect(again.text).toBe(never.text);
    expect(w.snapshot()).toEqual(before);
    expect(w.store.memberships().filter(({ role }) => role === 'ADMIN')).toHaveLength(1);
  });

  test('GRP-01-AC8: with ADMIN_BOOTSTRAP_CODE unset or unusable, a join with any code finds no group: 404, and nothing is written', async () => {
    const w = world({ bootstrapCode: null });
    const before = w.snapshot();

    for (const invitationCode of [syntheticBootstrapCode(), syntheticInvitationCode()]) {
      const answer = await w.join({
        invitationCode,
        joinKey: syntheticJoinKey(),
        displayName: syntheticDisplayName(),
      });
      expect(answer.status, invitationCode).toBe(404);
      expect(codeOf(answer)).toBe('INVITATION_NOT_VALID');
    }
    expect(w.snapshot()).toEqual(before);
    expect(w.store.groups()).toEqual([]);
  });
});

describe('GRP-01: the admin’s invitation', () => {
  test('GRP-01-AC1: the admin asks for an invitation: 201, a code of 20 base32 characters in four groups of five, expiring exactly seven days after the clock’s now; only its SHA-256 is stored, and one INVITATION_CREATED audit row names the admin and the invitation', async () => {
    const w = world();
    const admin = await w.admin();
    w.clock.advance(93_250);
    const now = await w.clock.now();

    const answer = await w.invite(admin);

    expect(answer.status).toBe(201);
    const { invitationCode, expiresAt } = answer.body as {
      invitationCode: string;
      expiresAt: string;
    };
    expect(Object.keys(answer.body as object).sort()).toEqual(['expiresAt', 'invitationCode']);
    expect(invitationCode).toMatch(SHOWN_INVITATION_CODE);
    expect(expiresAt).toBe(new Date(now.getTime() + SEVEN_DAYS).toISOString());
    const stored = invitationCode.replace(/[- ]/g, '');
    const [invitation, ...others] = w.store.invitations();
    expect(others).toEqual([]);
    expect(invitation).toMatchObject({
      codeHash: sha256Hex(stored),
      createdBy: admin.userId,
      createdAt: now,
      usedAt: null,
    });
    expect(JSON.stringify(w.store.invitations())).not.toContain(stored);
    expect(w.store.auditLog().filter(({ action }) => action === 'INVITATION_CREATED')).toEqual([
      {
        id: expect.any(Number) as unknown,
        at: now,
        actorId: admin.userId,
        action: 'INVITATION_CREATED',
        subjectId: invitation?.id,
      },
    ]);
  });

  test('GRP-01-AC9: a member who is not the admin asks for an invitation, or for the member list: 403 NOT_THE_ADMIN, and nothing is written', async () => {
    const w = world();
    const admin = await w.admin();
    const member = await w.member(admin);
    const before = w.snapshot();

    const invite = await w.invite(member);
    const list = await w.members(member);

    expect([invite.status, codeOf(invite)]).toEqual([403, 'NOT_THE_ADMIN']);
    expect([list.status, codeOf(list)]).toEqual([403, 'NOT_THE_ADMIN']);
    expect(w.snapshot()).toEqual(before);
    expect(w.log.events).toEqual([]);
  });

  test('GRP-01-AC9: the admin’s list holds each member’s ID, the name they typed and their role, and nobody else: no canary user, no user who is no member', async () => {
    const w = world();
    const admin = await w.admin();
    const [first, second] = [await w.member(admin), await w.member(admin)];
    await w.store.registerCanary({ credentialHash: sha256Hex(syntheticCredential()) });
    w.store.addUser();

    const answer = await w.members(admin);

    expect(answer.status).toBe(200);
    const byId = <T extends { userId: string }>(rows: T[]) =>
      [...rows].sort((a, b) => a.userId.localeCompare(b.userId));
    expect(Object.keys(answer.body as object)).toEqual(['members']);
    expect(byId((answer.body as { members: { userId: string }[] }).members)).toEqual(
      byId([
        { userId: admin.userId, displayName: admin.displayName, role: 'ADMIN' },
        { userId: first.userId, displayName: first.displayName, role: 'MEMBER' },
        { userId: second.userId, displayName: second.displayName, role: 'MEMBER' },
      ]),
    );
    expect(answer.text).not.toContain(CANARY_IDS.walkerId);
    expect(answer.text).not.toContain(CANARY_IDS.responderId);
  });

  test('GRP-01-AC9: an invitation asked for with a body holding any key is the fixed 400, and nothing is written', async () => {
    const w = world();
    const admin = await w.admin();
    const before = w.snapshot();

    const answer = await w.call('POST', INVITATIONS, {
      credential: admin.credential,
      body: { name: syntheticDisplayName() },
    });

    expect(answer.status).toBe(400);
    expect(answer.text).toBe(await fixed400(w, admin));
    expect(w.snapshot()).toEqual(before);
  });
});

describe('GRP-01: joining with an invitation', () => {
  test('GRP-01-AC3: a phone joins with an unused invitation, its join key and the name typed: 201 with a 43-character credential, the new user and MEMBER, Cache-Control no-store; one user, one membership, one device holding only the credential’s SHA-256; the invitation used, at the clock’s now, by that user, with the join key’s SHA-256; GET /v1/me then answers that user, name and role', async () => {
    const w = world();
    const admin = await w.admin();
    const shown = await w.invitation(admin);
    const joinKey = syntheticJoinKey();
    const displayName = syntheticDisplayName();
    const users = w.store.userIds().length;
    w.clock.advance(4 * HOUR);
    const now = await w.clock.now();

    const answer = await w.join({ invitationCode: shown, joinKey, displayName });

    expect(answer.status).toBe(201);
    expect(answer.body).toEqual({
      credential: expect.stringMatching(BASE64URL_43) as unknown,
      userId: expect.any(String) as unknown,
      role: 'MEMBER',
    });
    expect(answer.headers.get('cache-control')).toBe('no-store');
    const { userId, credential } = answer.body as { userId: string; credential: string };
    expect(w.store.userIds()).toHaveLength(users + 1);
    expect(w.store.memberships().filter((row) => row.userId === userId)).toEqual([
      expect.objectContaining({ role: 'MEMBER', displayName }) as unknown,
    ]);
    expect(w.store.devices().filter((device) => device.userId === userId)).toEqual([
      { id: expect.any(String) as unknown, userId, credentialHash: sha256Hex(credential) },
    ]);
    expect(w.store.invitations()[0]).toMatchObject({
      usedAt: now,
      usedBy: userId,
      joinKeyHash: sha256Hex(joinKey),
    });
    const me = await w.me({ credential });
    expect([me.status, me.body]).toEqual([200, { userId, displayName, role: 'MEMBER' }]);
  });

  test('GRP-01-AC3: the code is read at the edge as a person types it: in lower case, with spaces for hyphens, O for 0 and I or L for 1', async () => {
    const w = world();
    const admin = await w.admin();
    const shown = await w.invitation(admin);
    const typed = shown.replace(/[- ]/g, ' ').toLowerCase().replace(/0/g, 'o').replace(/1/g, 'l');

    const answer = await w.join({
      invitationCode: `  ${typed}  `,
      joinKey: syntheticJoinKey(),
      displayName: syntheticDisplayName(),
    });

    expect(answer.status, answer.text).toBe(201);
  });

  test('GRP-01-AC3: the name typed is kept trimmed of the spaces around it', async () => {
    const w = world();
    const admin = await w.admin();
    const displayName = syntheticDisplayName();

    const answer = await w.join({
      invitationCode: await w.invitation(admin),
      joinKey: syntheticJoinKey(),
      displayName: `   ${displayName}  `,
    });

    expect(answer.status).toBe(201);
    const { credential } = answer.body as { credential: string };
    expect((await w.me({ credential })).body).toMatchObject({ displayName });
  });

  test('GRP-01-AC2: nobody joins without a valid invitation: a code that never existed, a used one with another join key, an expired one, and the bootstrap code once a group exists are each the same 404 INVITATION_NOT_VALID, the same body, and write nothing, no log line included', async () => {
    const w = world();
    const admin = await w.admin();
    const used = await w.invitation(admin);
    await w.joinWith(used);
    const expired = await w.invitation(admin);
    w.clock.advance(SEVEN_DAYS);
    const before = w.snapshot();

    const answers: Answer[] = [];
    for (const invitationCode of [syntheticInvitationCode(), used, expired, w.bootstrapCode]) {
      answers.push(
        await w.join({
          invitationCode,
          joinKey: syntheticJoinKey(),
          displayName: syntheticDisplayName(),
        }),
      );
    }

    expect(answers.map(({ status }) => status)).toEqual([404, 404, 404, 404]);
    expect(answers.map(codeOf)).toEqual(Array.from({ length: 4 }, () => 'INVITATION_NOT_VALID'));
    expect(new Set(answers.map(({ text }) => text)).size).toBe(1);
    expect(w.snapshot()).toEqual(before);
    expect(w.log.events).toEqual([]);
  });

  test.each([
    ['a code of the wrong length', () => ({ invitationCode: 'ABCDE-FGHJK' })],
    ['a code with a character no code has', () => ({ invitationCode: 'ABCDE-FGHJK-MNPQR-STVWU' })],
    ['a code with punctuation', () => ({ invitationCode: 'ABCDE.FGHJK.MNPQR.STVWX' })],
    ['an empty code', () => ({ invitationCode: '' })],
    ['a code that is not text', () => ({ invitationCode: 12345 })],
    ['a join key that is not 43 base64url characters', () => ({ joinKey: 'short' })],
    [
      'a join key with a character base64url has not',
      () => ({ joinKey: `${syntheticJoinKey().slice(0, 42)}=` }),
    ],
    ['an empty name', () => ({ displayName: '' })],
    ['a name of spaces only', () => ({ displayName: '    ' })],
    ['a name of 41 characters', () => ({ displayName: 'x'.repeat(41) })],
    ['a name with a control character', () => ({ displayName: 'Testmedlem\u0007Ø' })],
    ['another key beside the three', () => ({ userId: syntheticUuid() })],
    ['a role asked for', () => ({ role: 'ADMIN' })],
  ] as const)(
    'GRP-01-AC2: a join with %s is the fixed 400, the same body every route gives, and nothing is written',
    async (_what, change) => {
      const w = world();
      const admin = await w.admin();
      const invitationCode = await w.invitation(admin);
      const before = w.snapshot();

      const answer = await w.join({
        invitationCode,
        joinKey: syntheticJoinKey(),
        displayName: syntheticDisplayName(),
        ...change(),
      });

      expect(answer.status).toBe(400);
      expect(answer.text).toBe(await fixed400(w, admin));
      expect(w.snapshot()).toEqual(before);
    },
  );

  test('GRP-01-AC2: a join with a key missing, or a body that is not JSON, is the fixed 400 too', async () => {
    const w = world();
    const admin = await w.admin();
    const invitationCode = await w.invitation(admin);
    const fixed = await fixed400(w, admin);

    for (const body of [
      { joinKey: syntheticJoinKey(), displayName: syntheticDisplayName() },
      { invitationCode, displayName: syntheticDisplayName() },
      { invitationCode, joinKey: syntheticJoinKey() },
    ]) {
      const answer = await w.join(body);
      expect([answer.status, answer.text], JSON.stringify(Object.keys(body))).toEqual([400, fixed]);
    }
    const notJson = await answerOf(
      await w.api.request(JOIN, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"invitationCode":',
      }),
    );
    expect([notJson.status, notJson.text]).toEqual([400, fixed]);
  });

  test('GRP-01-AC6: an invitation is valid until seven days after it was made, by the clock: a join at 7 days − 1 ms is 201; another invitation of the same moment, tried at 7 days exactly, is 404 INVITATION_NOT_VALID', async () => {
    const w = world();
    const admin = await w.admin();
    const early = await w.invitation(admin);
    const late = await w.invitation(admin);

    w.clock.advance(SEVEN_DAYS - 1);
    const first = await w.join({
      invitationCode: early,
      joinKey: syntheticJoinKey(),
      displayName: syntheticDisplayName(),
    });
    w.clock.advance(1);
    const second = await w.join({
      invitationCode: late,
      joinKey: syntheticJoinKey(),
      displayName: syntheticDisplayName(),
    });

    expect(first.status).toBe(201);
    expect([second.status, codeOf(second)]).toEqual([404, 'INVITATION_NOT_VALID']);
  });
});

describe('GRP-01: a join whose answer was lost, retried (F2)', () => {
  test('GRP-01-AC5: the same code sent again with the same join key is 201 again, the same user, a new credential, no-store; the first credential is then 401 and the new one works; no second user, membership or device', async () => {
    const w = world();
    const admin = await w.admin();
    const invitationCode = await w.invitation(admin);
    const phone = await w.joinWith(invitationCode);
    const before = w.snapshot();

    const again = await w.join({
      invitationCode,
      joinKey: phone.joinKey,
      displayName: phone.displayName,
    });

    expect(again.status).toBe(201);
    expect(again.headers.get('cache-control')).toBe('no-store');
    const { userId, credential, role } = again.body as {
      userId: string;
      credential: string;
      role: string;
    };
    expect([userId, role]).toEqual([phone.userId, 'MEMBER']);
    expect(credential).toMatch(BASE64URL_43);
    expect(credential).not.toBe(phone.credential);
    const old = await w.me(phone);
    expect([old.status, old.text]).toEqual([401, await unknown401(w)]);
    expect((await w.me({ credential })).status).toBe(200);
    const after = w.snapshot();
    expect(after.users).toBe(before.users);
    expect(after.memberships).toEqual(before.memberships);
    expect(after.devices.map(({ id, userId: owner }) => ({ id, owner }))).toEqual(
      before.devices.map(({ id, userId: owner }) => ({ id, owner })),
    );
  });

  test('GRP-01-AC5: the same code with another key is 404, and so is the same key once the user has been removed, and once the invitation has expired', async () => {
    const w = world();
    const admin = await w.admin();
    const removedCode = await w.invitation(admin);
    const removed = await w.joinWith(removedCode);
    const expiringCode = await w.invitation(admin);
    const expiring = await w.joinWith(expiringCode);

    const otherKey = await w.join({
      invitationCode: expiringCode,
      joinKey: syntheticJoinKey(),
      displayName: syntheticDisplayName(),
    });
    expect((await w.removeMember(admin, removed.userId)).status).toBe(200);
    const afterRemoval = await w.join({
      invitationCode: removedCode,
      joinKey: removed.joinKey,
      displayName: removed.displayName,
    });
    w.clock.advance(SEVEN_DAYS);
    const afterExpiry = await w.join({
      invitationCode: expiringCode,
      joinKey: expiring.joinKey,
      displayName: expiring.displayName,
    });

    for (const answer of [otherKey, afterRemoval, afterExpiry]) {
      expect([answer.status, codeOf(answer)]).toEqual([404, 'INVITATION_NOT_VALID']);
    }
    expect((await w.me(removed)).status).toBe(401);
    expect((await w.me(expiring)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Sessions (AC10, AC11).
// ---------------------------------------------------------------------------

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

interface Route {
  key: string;
  method: string;
  path: string;
}

/** Every route the contract describes, read from the generated document, path parameters filled with UUIDs. */
async function contractRoutes(): Promise<Route[]> {
  const document = await openApiDocument();
  const paths = document['paths'] as Record<string, Record<string, unknown>>;
  return Object.entries(paths).flatMap(([path, item]) =>
    Object.keys(item)
      .filter((method) => HTTP_METHODS.includes(method))
      .map((method) => ({
        key: `${method.toUpperCase()} ${API_PREFIX}${path}`,
        method: method.toUpperCase(),
        path: `${API_PREFIX}${path.replace(/\{[^}]*\}/g, () => syntheticUuid())}`,
      })),
  );
}

/** A body for a route with one: an empty object, which every route refuses or ignores. */
const bodyFor = (route: Route): unknown =>
  ['POST', 'PUT', 'PATCH'].includes(route.method) ? {} : undefined;

describe('GRP-01: the public routes are exactly health and the join', () => {
  test('GRP-01-AC10: the contract has the join, POST /v1/group/members, and the public list is exactly it and GET /v1/health', async () => {
    const keys = (await contractRoutes()).map(({ key }) => key);

    expect(keys).toEqual(expect.arrayContaining(PUBLIC_ROUTES));
    for (const route of [
      'GET /v1/me',
      'POST /v1/group/invitations',
      'GET /v1/group/members',
      'DELETE /v1/group/members/{userId}',
      'DELETE /v1/journeys/{journeyId}/responders/{responderId}',
    ]) {
      expect(keys, route).toContain(route);
    }
  });

  test.each([
    ['no Authorization header', (): Record<string, string> => ({})],
    ['an empty Authorization header', () => ({ authorization: '' })],
    ['a scheme other than Bearer', () => ({ authorization: `Basic ${syntheticCredential()}` })],
    ['Bearer with nothing after it', () => ({ authorization: 'Bearer' })],
    ['a credential no device has', () => ({ authorization: `Bearer ${syntheticCredential()}` })],
  ])(
    'GRP-01-AC10: with %s, every route but health and the join is the one 401, the same body, and no handler runs',
    async (_form, headers) => {
      const w = world();
      const admin = await w.admin();
      const before = w.snapshot();
      const calls = w.store.calls.length;
      const answers: { route: string; status: number; text: string }[] = [];

      for (const route of await contractRoutes()) {
        if (PUBLIC_ROUTES.includes(route.key)) {
          continue;
        }
        const body = bodyFor(route);
        const response = await w.api.request(route.path, {
          method: route.method,
          headers:
            body === undefined ? headers() : { ...headers(), 'content-type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        answers.push({ route: route.key, status: response.status, text: await response.text() });
      }

      expect(answers.length).toBeGreaterThanOrEqual(10);
      expect(answers.map(({ route, status }) => ({ route, status }))).toEqual(
        answers.map(({ route }) => ({ route, status: 401 })),
      );
      expect(new Set(answers.map(({ text }) => text)).size).toBe(1);
      expect(w.store.calls.slice(calls).filter((call) => call !== 'authenticate')).toEqual([]);
      expect(w.snapshot()).toEqual(before);
      expect(admin.userId).toEqual(expect.any(String));
    },
  );

  test('GRP-01-AC10: without a credential, exactly health and the join answer other than 401', async () => {
    const w = world();
    const answering: string[] = [];

    for (const route of await contractRoutes()) {
      const body = bodyFor(route);
      const response = await w.api.request(route.path, {
        method: route.method,
        ...(body === undefined
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      });
      if (response.status !== 401) {
        answering.push(route.key);
      }
    }

    expect(answering.sort()).toEqual([...PUBLIC_ROUTES].sort());
  });
});

describe('GRP-01: a device authenticates only while its user is a member', () => {
  test('GRP-01-AC11: once member M is removed, M’s device is the one 401 on every authenticated route, the same body as a credential no device has', async () => {
    const w = world();
    const admin = await w.admin();
    const member = await w.member(admin);
    expect((await w.me(member)).status).toBe(200);
    expect((await w.removeMember(admin, member.userId)).status).toBe(200);
    const unknown = await unknown401(w);
    const answers: { route: string; status: number; text: string }[] = [];

    for (const route of await contractRoutes()) {
      if (PUBLIC_ROUTES.includes(route.key)) {
        continue;
      }
      const body = bodyFor(route);
      const response = await w.api.request(route.path, {
        method: route.method,
        headers: {
          authorization: `Bearer ${member.credential}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      answers.push({ route: route.key, status: response.status, text: await response.text() });
    }

    expect(answers.map(({ route, status }) => ({ route, status }))).toEqual(
      answers.map(({ route }) => ({ route, status: 401 })),
    );
    expect(new Set([...answers.map(({ text }) => text), unknown]).size).toBe(1);
  });

  test('GRP-01-AC11: the canary’s device still authenticates, with no membership: GET /v1/me is 404 NOT_A_MEMBER, never 401, and its start naming its own responder is 201', async () => {
    const w = world();
    await w.admin();
    const credential = syntheticCredential();
    await w.store.registerCanary({ credentialHash: sha256Hex(credential) });

    const me = await w.me({ credential });
    const start = await w.start({ credential }, [CANARY_IDS.responderId]);

    expect([me.status, codeOf(me)]).toEqual([404, 'NOT_A_MEMBER']);
    expect(start.status, start.text).toBe(201);
  });

  test('GRP-01-AC11: a store that cannot answer who a credential is is a 500, never a 401: a database that blinked signs nobody out', async () => {
    const w = world();
    const admin = await w.admin();
    w.store.failWith(
      Object.assign(new Error('the database could not answer'), { code: '57P01' }),
      'authenticate',
    );

    const answers = [await w.me(admin), await w.members(admin), await w.invite(admin)];

    expect(answers.map(({ status }) => status)).toEqual([500, 500, 500]);
    w.store.recover();
    expect((await w.me(admin)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Who can be a responder (AC12, AC13, AC14).
// ---------------------------------------------------------------------------

describe('GRP-01: a journey’s responders must be current members of the walker’s group', () => {
  test('GRP-01-AC12: W names R1 and, in turn, a removed member X, a user U who never joined, the canary’s responder, or W: each is 422 INVALID_RESPONDER and nothing is stored, the whole start refused; R1 alone starts the journey', async () => {
    const w = world();
    const admin = await w.admin();
    const walker = await w.member(admin);
    const [r1, x] = [await w.member(admin), await w.member(admin)];
    await w.member(admin);
    expect((await w.removeMember(admin, x.userId)).status).toBe(200);
    const plainUser = w.store.addUser();
    await w.store.registerCanary({ credentialHash: sha256Hex(syntheticCredential()) });
    const before = w.snapshot();

    for (const other of [
      x.userId,
      plainUser,
      CANARY_IDS.responderId,
      CANARY_IDS.walkerId,
      walker.userId,
    ]) {
      const answer = await w.start(walker, [r1.userId, other]);
      expect([answer.status, codeOf(answer)], other).toEqual([422, 'INVALID_RESPONDER']);
    }
    expect(w.snapshot()).toEqual(before);

    const journeyId = await w.started(walker, [r1.userId]);
    expect(w.respondersOf(journeyId)).toEqual([r1.userId]);
  });

  test('GRP-01-AC12: the refusal’s message says a responder named is the walker or is not a member of the walker’s group', async () => {
    const w = world();
    const admin = await w.admin();
    const walker = await w.member(admin);

    const answer = await w.start(walker, [w.store.addUser()]);

    expect((answer.body as { message?: unknown }).message).toBe(
      "A responder named is the walker, or is not a member of the walker's group.",
    );
  });

  test('GRP-01-AC13: a member removed after the start read them as eligible, before it writes, is not stored as its responder: the start writes nothing and answers 422 INVALID_RESPONDER', async () => {
    const w = world();
    const admin = await w.admin();
    const walker = await w.member(admin);
    const [kept, removed] = [await w.member(admin), await w.member(admin)];
    w.store.beforeNext('insertStarted', () => {
      w.store.removeMembership(removed.userId);
    });

    const answer = await w.start(walker, [kept.userId, removed.userId]);

    expect([answer.status, codeOf(answer)]).toEqual([422, 'INVALID_RESPONDER']);
    expect(w.store.journeys()).toEqual([]);
  });

  test('GRP-01-AC14: the canary’s credential can name only the canary’s responder: naming a real member is 422 INVALID_RESPONDER, naming its responder alone starts the journey; no member can name the canary’s walker or responder', async () => {
    const w = world();
    const admin = await w.admin();
    const member = await w.member(admin);
    const credential = syntheticCredential();
    await w.store.registerCanary({ credentialHash: sha256Hex(credential) });

    const realMember = await w.start({ credential }, [member.userId]);
    const both = await w.start({ credential }, [CANARY_IDS.responderId, member.userId]);
    const fromMember = [
      await w.start(member, [CANARY_IDS.responderId]),
      await w.start(member, [CANARY_IDS.walkerId]),
    ];
    const own = await w.start({ credential }, [CANARY_IDS.responderId]);

    expect([realMember.status, codeOf(realMember)]).toEqual([422, 'INVALID_RESPONDER']);
    expect([both.status, codeOf(both)]).toEqual([422, 'INVALID_RESPONDER']);
    for (const answer of fromMember) {
      expect([answer.status, codeOf(answer)]).toEqual([422, 'INVALID_RESPONDER']);
    }
    expect(own.status, own.text).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// The admin removes a member (AC15's route half, AC16 to AC19, AC21).
// ---------------------------------------------------------------------------

describe('GRP-01: the admin’s removal of a member', () => {
  test('GRP-01-AC16: A removes M: 200 REMOVED; A removes M again, a user who is no member, an ID no user has, or either canary user: 404 MEMBER_NOT_FOUND; A removes A: 409 CANNOT_REMOVE_ADMIN; a member removes anyone: 403 NOT_THE_ADMIN; a user ID that is not a UUID: the fixed 400; and no refusal writes anything, or a line', async () => {
    const w = world();
    const admin = await w.admin();
    const [m, other] = [await w.member(admin), await w.member(admin)];
    const plainUser = w.store.addUser();
    await w.store.registerCanary({ credentialHash: sha256Hex(syntheticCredential()) });

    const removed = await w.removeMember(admin, m.userId);
    expect([removed.status, removed.body]).toEqual([200, { outcome: 'REMOVED' }]);
    const before = w.snapshot();

    const refusals: [string, Answer, number, string | null][] = [
      ['M again', await w.removeMember(admin, m.userId), 404, 'MEMBER_NOT_FOUND'],
      ['a user who is no member', await w.removeMember(admin, plainUser), 404, 'MEMBER_NOT_FOUND'],
      ['an ID no user has', await w.removeMember(admin, syntheticUuid()), 404, 'MEMBER_NOT_FOUND'],
      [
        'the canary’s walker',
        await w.removeMember(admin, CANARY_IDS.walkerId),
        404,
        'MEMBER_NOT_FOUND',
      ],
      [
        'the canary’s responder',
        await w.removeMember(admin, CANARY_IDS.responderId),
        404,
        'MEMBER_NOT_FOUND',
      ],
      ['A themself', await w.removeMember(admin, admin.userId), 409, 'CANNOT_REMOVE_ADMIN'],
      ['a member removing A', await w.removeMember(other, admin.userId), 403, 'NOT_THE_ADMIN'],
      [
        'a member removing themself',
        await w.removeMember(other, other.userId),
        403,
        'NOT_THE_ADMIN',
      ],
      [
        'a member removing no one',
        await w.removeMember(other, syntheticUuid()),
        403,
        'NOT_THE_ADMIN',
      ],
      ['an ID that is not a UUID', await w.removeMember(admin, 'not-a-uuid'), 400, null],
    ];
    for (const [what, answer, status, code] of refusals) {
      expect(answer.status, what).toBe(status);
      if (code !== null) {
        expect(codeOf(answer), what).toBe(code);
      }
    }
    expect(refusals.at(-1)?.[1].text).toBe(await fixed400(w, admin));
    expect(w.snapshot()).toEqual(before);
    expect(w.log.events).toEqual([]);
    expect((await w.me(other)).status).toBe(200);
  });

  test('GRP-01-AC17: M, a responder on unended J1 and J2 and on ended J0, with two devices, is removed by the admin: M’s membership and name are gone, M’s rows on J1 and J2 deleted and J0’s left as it was; one MEMBER_REMOVED audit row names the admin, M and the clock’s now; and from then both of M’s devices are 401', async () => {
    const w = world();
    const admin = await w.admin();
    const m = await w.member(admin);
    const tablet = w.store.addDeviceWithCredential(m.userId);
    const keeper = await w.member(admin);
    const [w1, w2, w0] = [await w.member(admin), await w.member(admin), await w.member(admin)];
    const j1 = await w.started(w1, [m.userId, keeper.userId]);
    const j2 = await w.seed(w2, [keeper.userId, m.userId], { state: 'LOST_CONTACT' });
    const j0 = await w.seed(w0, [m.userId, keeper.userId], { state: 'ENDED' });
    w.clock.advance(31_000);
    const now = await w.clock.now();

    const answer = await w.removeMember(admin, m.userId);

    expect([answer.status, answer.body]).toEqual([200, { outcome: 'REMOVED' }]);
    expect(w.store.memberships().map(({ userId }) => userId)).not.toContain(m.userId);
    expect(JSON.stringify(w.store.memberships())).not.toContain(m.displayName);
    expect(w.respondersOf(j1)).toEqual([keeper.userId]);
    expect(w.respondersOf(j2)).toEqual([keeper.userId]);
    expect(w.respondersOf(j0)).toEqual([m.userId, keeper.userId].sort());
    expect(w.store.auditLog().filter(({ action }) => action === 'MEMBER_REMOVED')).toEqual([
      {
        id: expect.any(Number) as unknown,
        at: now,
        actorId: admin.userId,
        action: 'MEMBER_REMOVED',
        subjectId: m.userId,
      },
    ]);
    expect((await w.me(m)).status).toBe(401);
    expect((await w.me({ credential: tablet.credential })).status).toBe(401);
    // The user's row stays: journeys, alerts and messages refer to it (reading 6).
    expect(w.store.userIds()).toContain(m.userId);
  });

  test('GRP-01-AC18: R1, on a journey whose lost-contact alert is open and whose message to R1 is not yet handed to the push port, is removed by the admin: R1’s unsent messages are withdrawn and none is ever handed to the push or SMS port; at two minutes only R2 gets the SMS; and on W’s next journey, silent after the removal, no message of any kind names R1', async () => {
    const w = world();
    const admin = await w.admin();
    const walker = await w.member(admin);
    const [r1, r2] = [await w.member(admin), await w.member(admin)];
    const journeyId = await w.started(walker, [r1.userId, r2.userId]);
    expect((await w.heartbeat(walker, journeyId)).status).toBe(200);
    const lastContact = (await w.clock.now()).getTime();
    // The sweep alone, at five minutes: the alert opens, and no delivery has run.
    w.clock.advance(FIVE_MINUTES);
    expect((await w.watchdog.sweep()).opened).toBe(1);
    const [alert] = w.alertsOf(journeyId);
    const toR1 = w.messagesOf(journeyId).filter(({ recipientId }) => recipientId === r1.userId);
    expect(toR1.map(({ sentAt }) => sentAt)).toEqual([null]);
    expect(w.push.messages).toEqual([]);

    expect((await w.removeMember(admin, r1.userId)).status).toBe(200);

    expect(
      w
        .messagesOf(journeyId)
        .filter(({ recipientId }) => recipientId === r1.userId)
        .map(({ withdrawnAt }) => withdrawnAt),
    ).toEqual([await w.clock.now()]);
    await w.runUntil(lastContact + FIVE_MINUTES + TWO_MINUTES + MINUTE);
    expect(w.store.alerts().find(({ id }) => id === alert?.id)?.state).toBe('ESCALATED');
    expect(w.push.messages.map(({ recipientId }) => recipientId)).not.toContain(r1.userId);
    expect(w.push.messages.map(({ recipientId }) => recipientId)).toContain(r2.userId);
    expect(w.sms.messages.map(({ recipientId }) => recipientId)).toEqual([r2.userId]);

    // W's next journey: R1 cannot be named, and silence on it tells R2 alone.
    expect((await w.home(walker, journeyId)).status).toBe(200);
    const refused = await w.start(walker, [r1.userId]);
    expect([refused.status, codeOf(refused)]).toEqual([422, 'INVALID_RESPONDER']);
    const next = await w.started(walker, [r2.userId]);
    const nextContact = (await w.clock.now()).getTime();
    await w.runUntil(nextContact + FIVE_MINUTES + TWO_MINUTES + MINUTE);
    expect(w.alertsOf(next)).toHaveLength(1);
    const everything = [
      ...w.store
        .outbox()
        .filter(({ createdAt }) => createdAt.getTime() > lastContact + FIVE_MINUTES),
      ...w.store.journeyMessages(),
      ...w.push.messages,
      ...w.sms.messages,
    ];
    expect(everything.map(({ recipientId }) => recipientId)).not.toContain(r1.userId);
  });

  test('GRP-01-AC19: R1 said "I’m on it" for an alert that already sent its SMS; the admin removes R1: the alert is back to OPEN, nobody recorded, its round raised, and every remaining responder gets a second SMS at the next sweep', async () => {
    const w = world();
    const admin = await w.admin();
    const walker = await w.member(admin);
    const [r1, r2, r3] = [await w.member(admin), await w.member(admin), await w.member(admin)];
    const journeyId = await w.started(walker, [r1.userId, r2.userId, r3.userId]);
    expect((await w.heartbeat(walker, journeyId)).status).toBe(200);
    const lastContact = (await w.clock.now()).getTime();
    await w.runUntil(lastContact + FIVE_MINUTES + TWO_MINUTES + 2 * INTERVAL);
    const [alert] = w.alertsOf(journeyId);
    const alertId = alert?.id ?? '';
    expect(w.sms.messages.map(({ recipientId }) => recipientId).sort()).toEqual(
      [r1.userId, r2.userId, r3.userId].sort(),
    );
    expect((await w.acknowledge(r1, alertId)).status).toBe(200);
    await w.runLoops();
    const textedBefore = w.sms.messages.length;

    expect((await w.removeMember(admin, r1.userId)).status).toBe(200);

    const reset = w.store.alerts().find(({ id }) => id === alertId);
    expect(reset).toMatchObject({
      state: 'OPEN',
      acknowledgedBy: null,
      acknowledgedAt: null,
      smsRaisedAt: null,
    });
    expect(w.roundOf(alertId)).toBe(2);
    w.clock.advance(INTERVAL);
    await w.runLoops();
    const second = w.sms.messages.slice(textedBefore).map(({ recipientId }) => recipientId);
    expect(second.sort()).toEqual([r2.userId, r3.userId].sort());
  });

  test('GRP-01-AC19: a journey whose only responder the admin removes: the walker gets the NO_RESPONDER warning; when the journey then goes silent, its alert opens with nobody to tell and the SMS check reports failing', async () => {
    const w = world();
    const admin = await w.admin();
    const walker = await w.member(admin);
    const only = await w.member(admin);
    const journeyId = await w.started(walker, [only.userId]);
    expect((await w.heartbeat(walker, journeyId)).status).toBe(200);
    const lastContact = (await w.clock.now()).getTime();

    expect((await w.removeMember(admin, only.userId)).status).toBe(200);

    expect(w.warningsOf(journeyId).map(({ recipientId, kind }) => ({ recipientId, kind }))).toEqual(
      [{ recipientId: walker.userId, kind: 'NO_RESPONDER' }],
    );
    expect(w.respondersOf(journeyId)).toEqual([]);
    await w.runUntil(lastContact + FIVE_MINUTES + INTERVAL);
    expect(w.stateOf(journeyId)).toBe('LOST_CONTACT');
    expect(w.alertsOf(journeyId)).toHaveLength(1);
    expect(w.messagesOf(journeyId)).toEqual([]);
    expect(await w.smsCheck.check()).toBe('failing');
    expect(w.alarm.statuses).toEqual(['failing']);
  });

  test('GRP-01-AC21: a removed member who is walking keeps their journey to its end: unchanged, R1 still on it, and silence still alerts R1; their heartbeats and "I’m home" are accepted; they can start nothing, acknowledge nothing and reach no member or admin route; once the journey has ended, their device is 401 everywhere', async () => {
    const w = world();
    const admin = await w.admin();
    const m = await w.member(admin);
    const r1 = await w.member(admin);
    const journeyId = await w.started(m, [r1.userId]);
    expect((await w.heartbeat(m, journeyId)).status).toBe(200);
    const before = w.store.journeys().find(({ id }) => id === journeyId);

    expect((await w.removeMember(admin, m.userId)).status).toBe(200);

    expect(w.store.journeys().find(({ id }) => id === journeyId)).toEqual(before);
    const beat = await w.heartbeat(m, journeyId);
    expect([beat.status, beat.body]).toEqual([200, { outcome: 'RECORDED' }]);
    const lastContact = (await w.clock.now()).getTime();
    await w.runUntil(lastContact + FIVE_MINUTES + INTERVAL);
    expect(w.stateOf(journeyId)).toBe('LOST_CONTACT');
    expect(w.push.messages.map(({ recipientId, kind }) => ({ recipientId, kind }))).toContainEqual({
      recipientId: r1.userId,
      kind: 'LOST_CONTACT',
    });
    const [alert] = w.alertsOf(journeyId);
    for (const [what, answer] of [
      ['a start', await w.start(m, [r1.userId])],
      ['"I’m on it"', await w.acknowledge(m, alert?.id ?? syntheticUuid())],
      ['GET /v1/me', await w.me(m)],
      ['an invitation', await w.invite(m)],
      ['the member list', await w.members(m)],
      ['a member’s removal', await w.removeMember(m, r1.userId)],
      ['a responder’s removal', await w.removeResponder(m, journeyId, r1.userId)],
    ] as const) {
      expect(answer.status, what).toBe(401);
    }

    const home = await w.home(m, journeyId);
    expect([home.status, home.body]).toEqual([200, { outcome: 'ENDED' }]);
    expect((await w.heartbeat(m, journeyId)).status).toBe(401);
    expect((await w.home(m, journeyId)).status).toBe(401);
    expect((await w.me(m)).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// The walker removes a responder (AC22, AC23): D-122's route.
// ---------------------------------------------------------------------------

describe('GRP-01: the walker removes a responder from their own journey', () => {
  test('GRP-01-AC22: W removes R1 from J, followed by R1 and R2: 200 REMOVED, with SM-10’s effects: R1’s row deleted, the alert R1 was on reset, R1’s unsent messages withdrawn; R1 is still a member, and W may name R1 again on a later journey', async () => {
    const w = world();
    const admin = await w.admin();
    const walker = await w.member(admin);
    const [r1, r2] = [await w.member(admin), await w.member(admin)];
    const journeyId = await w.started(walker, [r1.userId, r2.userId]);
    expect((await w.heartbeat(walker, journeyId)).status).toBe(200);
    w.clock.advance(FIVE_MINUTES);
    expect((await w.watchdog.sweep()).opened).toBe(1);
    const [alert] = w.alertsOf(journeyId);
    expect((await w.acknowledge(r1, alert?.id ?? '')).status).toBe(200);

    const answer = await w.removeResponder(walker, journeyId, r1.userId);

    expect([answer.status, answer.body]).toEqual([200, { outcome: 'REMOVED' }]);
    expect(w.respondersOf(journeyId)).toEqual([r2.userId]);
    expect(w.store.alerts().find(({ id }) => id === alert?.id)).toMatchObject({
      state: 'OPEN',
      acknowledgedBy: null,
    });
    expect(
      w
        .messagesOf(journeyId)
        .filter(({ recipientId, sentAt }) => recipientId === r1.userId && sentAt === null)
        .every(({ withdrawnAt }) => withdrawnAt !== null),
    ).toBe(true);
    expect(w.warningsOf(journeyId)).toEqual([]);
    expect((await w.me(r1)).status).toBe(200);
    expect(w.store.memberships().map(({ userId }) => userId)).toContain(r1.userId);
    expect(w.store.auditLog().filter(({ action }) => action === 'MEMBER_REMOVED')).toEqual([]);

    expect((await w.home(walker, journeyId)).status).toBe(200);
    const later = await w.started(walker, [r1.userId]);
    expect(w.respondersOf(later)).toEqual([r1.userId]);
  });

  test('GRP-01-AC22: W removes the last responder: 200 REMOVED, and W gets the NO_RESPONDER warning', async () => {
    const w = world();
    const admin = await w.admin();
    const walker = await w.member(admin);
    const only = await w.member(admin);
    const journeyId = await w.started(walker, [only.userId]);

    const answer = await w.removeResponder(walker, journeyId, only.userId);

    expect([answer.status, answer.body]).toEqual([200, { outcome: 'REMOVED' }]);
    expect(w.warningsOf(journeyId).map(({ recipientId, kind }) => ({ recipientId, kind }))).toEqual(
      [{ recipientId: walker.userId, kind: 'NO_RESPONDER' }],
    );
  });

  test.each(['ACTIVE', 'LOST_CONTACT', 'ENDED'] as const)(
    'GRP-01-AC23: J %s: another member X, and J’s own responder R2, asking to remove anyone from J, and anyone naming a journey that does not exist, each get the same 404 JOURNEY_NOT_FOUND, the same body; none writes anything or a line',
    async (state) => {
      const w = world();
      const admin = await w.admin();
      const walker = await w.member(admin);
      const [r1, r2, x] = [await w.member(admin), await w.member(admin), await w.member(admin)];
      const journeyId = await w.seed(walker, [r1.userId, r2.userId], { state });
      const before = w.snapshot();

      const answers: Answer[] = [];
      for (const caller of [x, r2, admin]) {
        for (const target of [r1.userId, r2.userId, x.userId, walker.userId, syntheticUuid()]) {
          answers.push(await w.removeResponder(caller, journeyId, target));
        }
      }
      for (const caller of [walker, x, r2]) {
        answers.push(await w.removeResponder(caller, syntheticUuid(), r1.userId));
      }

      expect(answers.map(({ status }) => status)).toEqual(answers.map(() => 404));
      expect(answers.map(codeOf)).toEqual(answers.map(() => 'JOURNEY_NOT_FOUND'));
      expect(new Set(answers.map(({ text }) => text)).size).toBe(1);
      expect(w.snapshot()).toEqual(before);
      expect(w.log.events).toEqual([]);
    },
  );

  test('GRP-01-AC23: W naming someone not on J is 409 NOT_A_RESPONDER; W on an ended J is 409 JOURNEY_ENDED, with the one line SM-07 writes; a journey or user ID that is not a UUID is the fixed 400; none of them writes anything', async () => {
    const w = world();
    const admin = await w.admin();
    const walker = await w.member(admin);
    const [r1, x] = [await w.member(admin), await w.member(admin)];
    const journeyId = await w.started(walker, [r1.userId]);
    const before = w.snapshot();

    const notOn = [
      await w.removeResponder(walker, journeyId, x.userId),
      await w.removeResponder(walker, journeyId, walker.userId),
      await w.removeResponder(walker, journeyId, syntheticUuid()),
    ];
    const badIds = [
      await w.removeResponder(walker, 'not-a-journey', r1.userId),
      await w.removeResponder(walker, journeyId, 'not-a-user'),
    ];

    for (const answer of notOn) {
      expect([answer.status, codeOf(answer)]).toEqual([409, 'NOT_A_RESPONDER']);
    }
    const fixed = await fixed400(w, walker);
    for (const answer of badIds) {
      expect([answer.status, answer.text]).toEqual([400, fixed]);
    }
    expect(w.snapshot()).toEqual(before);
    expect(w.log.events).toEqual([]);

    expect((await w.home(walker, journeyId)).status).toBe(200);
    const ended = await w.removeResponder(walker, journeyId, r1.userId);
    expect([ended.status, codeOf(ended)]).toEqual([409, 'JOURNEY_ENDED']);
    expect(w.respondersOf(journeyId)).toEqual([r1.userId]);
    expect(w.log.events).toEqual([
      { event: 'removal_ignored', reason: 'JOURNEY_ENDED', journeyId },
    ]);
  });
});

// ---------------------------------------------------------------------------
// The log (AC24's half a fake can show; L3 holds it against the database).
// ---------------------------------------------------------------------------

describe('GRP-01: nothing secret or personal reaches what the API writes', () => {
  test('GRP-01-AC24: a run through every new route, success and refusal and failure, with the real log: nothing written holds an invitation code, a join key, a credential or its hash, a display name or a user’s ID, and every line is a closed event', async () => {
    const markers: string[] = [];
    const failure = (code: string) =>
      Object.assign(new Error('the database could not answer'), { code });

    const { written } = await captured(async () => {
      const w = world({ log: createLog() });
      const admin = await w.admin();
      const shown = await w.invitation(admin);
      const member = await w.joinWith(shown);
      const walker = await w.member(admin);
      const journeyId = await w.started(walker, [member.userId]);
      markers.push(
        w.bootstrapCode ?? '',
        shown,
        shown.replace(/[- ]/g, ''),
        sha256Hex(shown.replace(/[- ]/g, '')),
        ...[admin, member, walker].flatMap((phone) => [
          phone.credential,
          sha256Hex(phone.credential),
          phone.joinKey,
          sha256Hex(phone.joinKey),
          phone.displayName,
          phone.userId,
        ]),
      );
      // Refusals.
      await w.join({
        invitationCode: shown,
        joinKey: syntheticJoinKey(),
        displayName: syntheticDisplayName(),
      });
      await w.join({
        invitationCode: 'ABC',
        joinKey: member.joinKey,
        displayName: member.displayName,
      });
      await w.invite(member);
      await w.members(member);
      await w.removeMember(member, walker.userId);
      await w.removeMember(admin, admin.userId);
      await w.removeResponder(member, journeyId, member.userId);
      await w.removeResponder(walker, journeyId, admin.userId);
      // Successes.
      await w.me(member);
      await w.members(admin);
      await w.join({
        invitationCode: shown,
        joinKey: member.joinKey,
        displayName: member.displayName,
      });
      await w.removeResponder(walker, journeyId, member.userId);
      // Failures, each a line of its own.
      w.store.failWith(failure('40001'), 'joinWithInvitation');
      await w.join({
        invitationCode: await w.invitation(admin),
        joinKey: syntheticJoinKey(),
        displayName: syntheticDisplayName(),
      });
      w.store.failWith(failure('23505'), 'createInvitation');
      await w.invite(admin);
      w.store.failWith(failure('55P03'), 'removeMember');
      await w.removeMember(admin, walker.userId);
      w.store.recover();
      await w.removeMember(admin, member.userId);
    });

    expect(
      markersIn(
        written,
        markers.filter((marker) => marker !== ''),
      ),
    ).toEqual([]);
    const lines = written.split('\n').filter((line) => line.trim() !== '');
    const events = lines.map((line) => parsedOrNull(line) as { event?: unknown } | null);
    expect(events.map((event) => event?.event)).toEqual(
      expect.arrayContaining(['join_failed', 'invitation_failed', 'member_removal_failed']),
    );
    for (const event of events) {
      expect(['join_failed', 'invitation_failed', 'member_removal_failed']).toContain(event?.event);
    }
  });
});
