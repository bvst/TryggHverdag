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
import { listen } from './http.ts';
import { createHealthService } from './modules/health/service.ts';
import { createJourneyService } from './modules/journeys/service.ts';

export interface ApiProcess {
  port: number;
  /** Closes the port, then the connection pool — in that order, so no request loses its database. */
  stop: () => Promise<void>;
}

export async function startApiProcess(config: ServerConfig): Promise<ApiProcess> {
  const pool = createPool(config.databaseUrl, POOL_SIZE.api);
  const db = createDatabase(pool);
  // One clock for every route: the database's, so a journey's start and the
  // watchdog's "how long since" are read from the same now.
  const clock = databaseClock(db);
  const app = createApi({
    health: createHealthService({ clock, heartbeats: databaseWorkerHeartbeats(db) }),
    journeys: createJourneyService({ clock, journeys: databaseJourneyStore(db) }),
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
