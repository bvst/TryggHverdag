/**
 * The staging canary's ways out (REL-10, PRIV-07; D-091 as D-128 amends it,
 * D-128): its registration and its read, over the worker's database, and its
 * client of the public API.
 *
 * The registration is the one insert of a device credential before the login
 * task: the worker writes the canary's three fixed identities, in one
 * transaction. Both users inserted if absent; the walker's one device
 * inserted with the hash of the canary's credential or, if it exists and is
 * the walker's, its hash replaced, which is how a rotated credential takes
 * effect. A device with the canary's ID that belongs to anyone else, or a
 * hash another device holds (the unique index), throws, and nothing is
 * written. The responder gets no device, so nothing can reach a phone at the
 * critical level (D-087). Held narrow by an import rule: only worker.ts
 * imports this file, and the API cannot reach it. A freshly migrated database
 * still holds no user and no device.
 *
 * The read is one statement, no lock and no write: now(), and the journey only
 * when its walker is the canary's, with its latest alert (the greatest
 * opening) and what the push port did with that alert's messages to the
 * canary's responder. "Answered" is any answer from the port, a send or a
 * failure with its reason (D-127).
 *
 * The client goes through the public API as a phone would, so the canary
 * proves Clever Cloud's routing, TLS, the API process, its authentication,
 * the contract's validation and its routes as well as the alert path behind
 * them (F8). Each request is one try, with its own timeout, follows no
 * redirect (a 3xx fails, naming its status), and carries the credential only
 * as `Authorization: Bearer`, only to the configured origin. Every failure is
 * a result holding an HTTP status or none, never a throw and never an error's
 * words, so no credential, address or answer's body can reach a log.
 */
import {
  API_PREFIX,
  heartbeatResponseSchema,
  homeResponseSchema,
  startJourneyErrors,
  startJourneyResponseSchema,
  type HeartbeatRequest,
  type StartJourneyRequest,
} from '@trygghverdag/contracts';
import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { alerts, devices, journeys, outbox, users } from '../db/schema.ts';
import { CANARY_DEVICE_ID, CANARY_RESPONDER_ID, CANARY_WALKER_ID } from '../domain/canary.ts';
import { databaseTime } from '../domain/database-time.ts';
import type {
  AlertResolution,
  AlertState,
  JourneyEndReason,
  JourneyState,
} from '../domain/journey.ts';
import type { CanaryCall, CanaryClient, CanaryObservation, CanaryStore } from '../ports.ts';
import type { Database } from './db.ts';

/** How long each of the client's requests waits for its answer before it counts as failed. */
export const CANARY_REQUEST_TIMEOUT_MS = 10_000;

/** A time the read may hand back as null, as null; any other as `databaseTime` reads it. */
function momentOrNull(value: unknown): Date | null {
  return value === null ? null : databaseTime(value, 'The canary’s read');
}

/** A yes or no from the read, refused when it is anything else. */
function yesOrNo(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new Error('The canary’s read returned something other than true or false.');
  }
  return value;
}

/** The canary's read, as the statement returns it. */
interface ObservationRow {
  [column: string]: unknown;
  now: unknown;
  state: JourneyState;
  started_at: unknown;
  last_heartbeat_at: unknown;
  end_reason: JourneyEndReason | null;
  alert_id: string | null;
  opened_at: unknown;
  alert_state: AlertState | null;
  resolution: AlertResolution | null;
  resolved_at: unknown;
  lost_contact_answered: unknown;
  stand_down_answered: unknown;
  sms_written: unknown;
}

/** Whether the port answered the canary's responder's message of this kind of the latest alert. */
const answered = (kind: 'LOST_CONTACT' | 'HOME') => sql`exists (
  select 1 from ${outbox}
   where ${outbox.alertId} = latest.id
     and ${outbox.recipientId} = ${CANARY_RESPONDER_ID}
     and ${outbox.kind} = ${kind}
     and (${outbox.sentAt} is not null or ${outbox.lastFailure} is not null))`;

export function databaseCanaryStore(db: Database): CanaryStore {
  return {
    async registerCanary({ credentialHash }: { credentialHash: string }): Promise<void> {
      if (credentialHash === '') {
        throw new Error('The canary’s registration needs its credential’s hash; none was given.');
      }
      await db.transaction(async (tx) => {
        await tx
          .insert(users)
          .values([{ id: CANARY_WALKER_ID }, { id: CANARY_RESPONDER_ID }])
          .onConflictDoNothing();
        // Replaced only on the walker's own device: one of the canary's ID
        // that is anyone else's is left alone, returns no row, and throws.
        const stored = await tx
          .insert(devices)
          .values({ id: CANARY_DEVICE_ID, userId: CANARY_WALKER_ID, credentialHash })
          .onConflictDoUpdate({
            target: devices.id,
            set: { credentialHash },
            setWhere: eq(devices.userId, CANARY_WALKER_ID),
          })
          .returning({ id: devices.id });
        if (stored.length !== 1) {
          throw new Error(
            'A device with the canary’s ID belongs to another user, so the canary’s registration ' +
              'is refused and nothing is written.',
          );
        }
      });
    },

    async observeCanaryJourney(journeyId: string): Promise<CanaryObservation | null> {
      const result = await db.execute<ObservationRow>(sql`
        select now() as now, ${journeys.state} as state, ${journeys.startedAt} as started_at,
               ${journeys.lastHeartbeatAt} as last_heartbeat_at,
               ${journeys.endReason} as end_reason,
               latest.id as alert_id, latest.opened_at, latest.state as alert_state,
               latest.resolution, latest.resolved_at,
               ${answered('LOST_CONTACT')} as lost_contact_answered,
               ${answered('HOME')} as stand_down_answered,
               (select count(*) from ${outbox}
                 where ${outbox.alertId} = latest.id
                   and ${outbox.kind} = 'LOST_CONTACT_SMS') as sms_written
          from ${journeys}
          left join lateral (
            select ${alerts.id}, ${alerts.openedAt}, ${alerts.state}, ${alerts.resolution},
                   ${alerts.resolvedAt}
              from ${alerts}
             where ${alerts.journeyId} = ${journeys.id}
             order by ${alerts.openedAt} desc, ${alerts.id} desc
             limit 1
          ) as latest on true
         where ${and(eq(journeys.id, journeyId), eq(journeys.walkerId, CANARY_WALKER_ID))}`);
      const [row] = result.rows;
      if (row === undefined) {
        return null;
      }
      // count(*) is a bigint, which the driver hands over as text.
      const smsWritten = Number(row.sms_written);
      if (!Number.isSafeInteger(smsWritten) || smsWritten < 0) {
        throw new Error('The canary’s read returned no count of escalation SMS.');
      }
      return {
        now: databaseTime(row.now, 'The canary’s read'),
        journey: {
          state: row.state,
          startedAt: databaseTime(row.started_at, 'The canary’s read'),
          lastHeartbeatAt: momentOrNull(row.last_heartbeat_at),
          endReason: row.end_reason,
        },
        alert:
          row.alert_id === null || row.alert_state === null
            ? null
            : {
                id: row.alert_id,
                openedAt: databaseTime(row.opened_at, 'The canary’s read'),
                state: row.alert_state,
                resolution: row.resolution,
                resolvedAt: momentOrNull(row.resolved_at),
              },
        lostContactAnswered: yesOrNo(row.lost_contact_answered),
        standDownAnswered: yesOrNo(row.stand_down_answered),
        smsWritten,
      };
    },
  };
}

/** No answer at all: a network failure, a timeout, or a request that could not be made. */
const NO_ANSWER = { ok: false, status: null, code: null } as const;

/** A start refused because the walker has an unended journey, which the answer names. */
const alreadyOnAJourney = z.object({
  code: z.literal('ALREADY_ON_A_JOURNEY'),
  data: startJourneyErrors.ALREADY_ON_A_JOURNEY.data,
});

/** An answer: its status, and its body as JSON, or undefined when it is not JSON. */
interface Answer {
  status: number;
  body: unknown;
}

export function httpCanaryClient({
  baseUrl,
  credential,
  fetch: send = fetch,
  timeoutMs = CANARY_REQUEST_TIMEOUT_MS,
}: {
  baseUrl: string;
  credential: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): CanaryClient {
  /**
   * One POST of `body` to the API's `path`, on the configured origin: its
   * answer, or null when there was none. Never a throw, and nothing of an
   * error kept.
   */
  const post = async (path: string, body: unknown): Promise<Answer | null> => {
    // The timer is a network timeout, not a safety decision, so it is not the
    // database clock's to keep (AR-03). Raced here as well as handed to the
    // fetch, so it ends the request and the reading of its answer whatever
    // the fetch does with its signal: the client never waits longer.
    const timeout = AbortSignal.timeout(timeoutMs);
    const timedOut = new Promise<never>((_resolve, reject) => {
      timeout.addEventListener('abort', () => {
        reject(new Error('The canary’s request timed out.'));
      });
    });
    timedOut.catch(() => undefined);
    let response: Response;
    try {
      // redirect 'manual': the credential goes nowhere but the configured
      // origin, and a 3xx comes back as it is, and fails below, naming its
      // status.
      response = await Promise.race([
        send(`${baseUrl}${API_PREFIX}${path}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
          redirect: 'manual',
          signal: timeout,
        }),
        timedOut,
      ]);
    } catch {
      return null;
    }
    try {
      return { status: response.status, body: await Promise.race([response.json(), timedOut]) };
    } catch {
      return { status: response.status, body: undefined };
    }
  };

  /** A failure naming the answer's status, or none when there was no answer. */
  const failure = (answer: Answer | null) =>
    answer === null ? NO_ANSWER : ({ ok: false, status: answer.status, code: null } as const);

  /** The route's success, its body as the contract says, or a failure naming the status. */
  const succeeded = (
    answer: Answer | null,
    status: number,
    schema: { safeParse: (body: unknown) => { success: boolean } },
  ): CanaryCall<null> =>
    answer?.status === status && schema.safeParse(answer.body).success
      ? { ok: true, value: null }
      : failure(answer);

  return {
    async start() {
      const answer = await post('/journeys', {
        responderIds: [CANARY_RESPONDER_ID],
      } satisfies StartJourneyRequest);
      if (answer?.status === 201) {
        const started = startJourneyResponseSchema.safeParse(answer.body);
        return started.success
          ? { ok: true, value: { journeyId: started.data.journeyId } }
          : failure(answer);
      }
      if (answer?.status === 409) {
        const refused = alreadyOnAJourney.safeParse(answer.body);
        if (refused.success) {
          return { ok: false, status: 409, journeyId: refused.data.data.journeyId };
        }
      }
      return failure(answer);
    },

    async heartbeat(journeyId: string) {
      // The event ID is made here, so the module stays free of randomness.
      const answer = await post('/heartbeats', {
        journeyId,
        eventId: randomUUID(),
        batteryLevel: null,
        position: null,
      } satisfies HeartbeatRequest);
      return succeeded(answer, 200, heartbeatResponseSchema);
    },

    async home(journeyId: string) {
      const answer = await post(`/journeys/${encodeURIComponent(journeyId)}/home`, {});
      return succeeded(answer, 200, homeResponseSchema);
    },
  };
}
