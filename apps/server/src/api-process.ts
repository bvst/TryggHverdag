/**
 * The API process: the real adapters, the API, and a port.
 *
 * `createApi` takes its dependencies so that tests can hand it fakes; this is
 * the one place that hands it the real ones. Kept apart from `bin/api.ts` so
 * that the wiring is tested in-process, where coverage and the mutation gate
 * can see it, and the entry file stays too small to be wrong.
 */
import { databaseClock } from './adapters/clock.ts';
import { POOL_SIZE, createDatabase, createPool } from './adapters/db.ts';
import { databaseDeviceAuthenticator } from './adapters/device-credentials.ts';
import { databaseJourneyStore } from './adapters/journeys.ts';
import { databaseWorkerHeartbeats } from './adapters/worker-heartbeats.ts';
import { createApi } from './api.ts';
import type { ServerConfig } from './config.ts';
import { IDLE_IN_TRANSACTION_LIMIT_MS, LOCK_WAIT_LIMIT_MS } from './domain/watchdog.ts';
import { listen } from './http.ts';
import { createLog } from './log.ts';
import { createHealthService } from './modules/health/service.ts';
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
  // every route, health included, would wait with them.
  const pool = createPool(config.databaseUrl, POOL_SIZE.api, {
    name: 'api',
    log,
    idleInTransactionMs: IDLE_IN_TRANSACTION_LIMIT_MS,
    lockTimeoutMs: LOCK_WAIT_LIMIT_MS,
  });
  const db = createDatabase(pool);
  // One clock for every route: the database's, so a journey's start and the
  // watchdog's "how long since" are read from the same now.
  const clock = databaseClock(db);
  const app = createApi({
    health: createHealthService({ clock, heartbeats: databaseWorkerHeartbeats(db) }),
    journeys: createJourneyService({ clock, journeys: databaseJourneyStore(db), log }),
    devices: databaseDeviceAuthenticator(db),
  });

  let server;
  try {
    server = await listen(app, config.port);
  } catch (error) {
    await pool.end();
    throw error;
  }

  return {
    port: server.port,
    async stop() {
      await server.close();
      await pool.end();
    },
  };
}
