/**
 * Wiring: take the ports, ask the domain, return the contract type.
 *
 * A module is deliberately thin. Everything that could be got wrong lives
 * either in the domain (where it is tested in milliseconds) or in an adapter
 * (where it is tested against a real database). What is left here is
 * translation, and translation is what the system test checks end to end.
 */
import { WORKER_STALE_AFTER_MS, type HealthResponse } from '@trygghverdag/contracts';
import { assessWorkerHealth } from '../../domain/health.ts';
import type { Clock, WorkerHeartbeats } from '../../ports.ts';

export interface HealthService {
  check(): Promise<HealthResponse>;
}

export function createHealthService({
  clock,
  heartbeats,
  staleAfterMs = WORKER_STALE_AFTER_MS,
}: {
  clock: Clock;
  heartbeats: WorkerHeartbeats;
  staleAfterMs?: number;
}): HealthService {
  return {
    async check(): Promise<HealthResponse> {
      const now = await clock.now();
      const lastBeat = await heartbeats.lastBeat();

      const worker = assessWorkerHealth({
        nowMs: now.getTime(),
        lastBeatMs: lastBeat === null ? null : lastBeat.getTime(),
        staleAfterMs,
      });

      return {
        status: worker.status,
        checkedAt: now.toISOString(),
        worker: {
          lastBeatAt: lastBeat === null ? null : lastBeat.toISOString(),
          silentForMs: worker.silentForMs,
        },
      };
    },
  };
}
