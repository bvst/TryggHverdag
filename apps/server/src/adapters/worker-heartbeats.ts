/**
 * The worker's check-ins, in PostgreSQL.
 *
 * A single upserted row. The worker writes it; the API reads it to answer
 * whether anything is still watching the journeys.
 */
import { eq } from 'drizzle-orm';
import type { WorkerHeartbeats } from '../ports.ts';
import { WATCHDOG_HEARTBEAT_ID, workerHeartbeat } from '../db/schema.ts';
import type { Database } from './db.ts';

export function databaseWorkerHeartbeats(db: Database): WorkerHeartbeats {
  return {
    async lastBeat(): Promise<Date | null> {
      const rows = await db
        .select({ beatAt: workerHeartbeat.beatAt })
        .from(workerHeartbeat)
        .where(eq(workerHeartbeat.id, WATCHDOG_HEARTBEAT_ID))
        .limit(1);

      return rows[0]?.beatAt ?? null;
    },

    async record(at: Date): Promise<void> {
      await db
        .insert(workerHeartbeat)
        .values({ id: WATCHDOG_HEARTBEAT_ID, beatAt: at })
        .onConflictDoUpdate({ target: workerHeartbeat.id, set: { beatAt: at } });
    },
  };
}
