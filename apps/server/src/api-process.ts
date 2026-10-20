/**
 * The API process: the real adapters, the API, and a port.
 *
 * `createApi` takes its dependencies so that tests can hand it fakes; this is
 * the one place that hands it the real ones. Kept apart from `bin/api.ts` so
 * that the wiring is tested in-process, where coverage and the mutation gate
 * can see it, and the entry file stays too small to be wrong.
 */
import process from 'node:process';
import { databaseClock } from './adapters/clock.ts';
import {
  POOL_SIZE,
  STATEMENT_TIMEOUT_MS,
  createDatabase,
  createPool,
  sessionLimitsLines,
} from './adapters/db.ts';
import { databaseDeviceAuthenticator } from './adapters/device-credentials.ts';
import { databaseGroupStore } from './adapters/groups.ts';
import { databaseJourneyStore } from './adapters/journeys.ts';
import { databaseWorkerHeartbeats } from './adapters/worker-heartbeats.ts';
import { createApi } from './api.ts';
import type { ServerConfig } from './config.ts';
import { IDLE_IN_TRANSACTION_LIMIT_MS, LOCK_WAIT_LIMIT_MS } from './domain/watchdog.ts';
import { listen } from './http.ts';
import { createLog } from './log.ts';
import { createAcknowledgementService } from './modules/alerts/acknowledgement.ts';
import { createClosureService } from './modules/alerts/closure.ts';
import { createInvitationService } from './modules/groups/invitations.ts';
import { createJoinService } from './modules/groups/join.ts';
import { createMemberService } from './modules/groups/members.ts';
import { createHealthService } from './modules/health/service.ts';
import { createRemovalService } from './modules/journeys/removal.ts';
import { createJourneyService } from './modules/journeys/service.ts';

export interface ApiProcess {
  port: number;
  /** Closes the port, then the connection pool — in that order, so no request loses its database. */
  stop: () => Promise<void>;
}

export async function startApiProcess(config: ServerConfig): Promise<ApiProcess> {
  // The one place the API's real log is made: modules get the Log port
  // (AR-10). It writes to this process's stdout, where the platform collects
  // it.
  const log = createLog();
  // The session limits bound how long a journey's row can be held (D-108): a
  // session idle inside a transaction is ended, and a heartbeat waits at most
  // LOCK_WAIT_LIMIT_MS for a row, then fails as a 500 the phone resends.
  // Without the lock limit, two such waits would hold both connections, and
  // every route, health included, would wait with them. And PostgreSQL
  // cancels any statement that runs longer than STATEMENT_TIMEOUT_MS (D-132).
  const limits = {
    idleInTransactionMs: IDLE_IN_TRANSACTION_LIMIT_MS,
    lockTimeoutMs: LOCK_WAIT_LIMIT_MS,
    statementTimeoutMs: STATEMENT_TIMEOUT_MS,
  };
  const pool = createPool(config.databaseUrl, POOL_SIZE.api, { name: 'api', log, ...limits });
  const db = createDatabase(pool);
  // One clock for every route: the database's, so a journey's start and the
  // watchdog's "how long since" are read from the same now.
  const clock = databaseClock(db);
  const store = databaseJourneyStore(db);
  const groups = databaseGroupStore(db);
  const app = createApi({
    health: createHealthService({ clock, heartbeats: databaseWorkerHeartbeats(db) }),
    journeys: createJourneyService({ clock, journeys: store, log }),
    devices: databaseDeviceAuthenticator(db),
    // "I'm on it" reads no clock: it records the database's now() (LOST-06).
    acknowledgements: createAcknowledgementService({ alerts: store, log }),
    // "They're safe" reads no clock either: it ends the journey at the
    // database's now() (LOST-08).
    closures: createClosureService({ alerts: store, log }),
    // GRP-01's red phase: wired, and reached by no route yet. The bootstrap
    // code is null until the green phase reads ADMIN_BOOTSTRAP_CODE
    // (readAdminBootstrapSetting) and says at start whether it is usable.
    joins: createJoinService({ groups, log, bootstrapCode: null }),
    invitations: createInvitationService({ groups, log }),
    members: createMemberService({ groups, log }),
    removals: createRemovalService({ journeys: store, log }),
  });

  let server;
  try {
    server = await listen(app, config.port);
  } catch (error) {
    await pool.end();
    throw error;
  }

  // Asking is not getting (D-109): the limits read back once, and said on
  // stderr, whatever they are. Not awaited: the API serves meanwhile, and
  // starts whatever it reads, since an API that refused to start would turn
  // every heartbeat away. The stop waits for it, so no line comes after.
  const limitsRead = sessionLimitsLines(pool, { name: 'api', ...limits }).then((lines) => {
    for (const line of lines) {
      process.stderr.write(`${line}\n`);
    }
  });

  return {
    port: server.port,
    async stop() {
      await server.close();
      await limitsRead;
      await pool.end();
    },
  };
}
