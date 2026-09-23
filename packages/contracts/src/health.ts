/**
 * The health endpoint: the first route, and the one a deploy gate and an uptime
 * monitor both call.
 *
 * It is only the endpoint. Something has to poll it and wake the owner when the
 * answer stops being `ok`, and that is INF-08's job — so this file does not
 * claim the requirement that covers the monitoring, only builds what it reads.
 *
 * It answers two different questions, and keeps them apart on purpose:
 *
 *   - Is this API process up? That is the HTTP status.
 *   - Is the *system* doing its job? That is `status` in the body. The API can
 *     be perfectly healthy while the worker — which owns the watchdog, and so
 *     owns every alert — has been silent for an hour. A monitor that only
 *     looked at the HTTP status would report a green service with nobody
 *     watching the journeys.
 */
import { oc } from '@orpc/contract';
import { z } from 'zod';

/**
 * How long the worker may be silent before this stops calling itself healthy.
 *
 * Three minutes, because the worker checks in once a minute — Graphile Worker's
 * cron is minute-granular — so two missed beats are tolerated before anyone is
 * woken. A threshold equal to the beat interval would page on ordinary jitter,
 * and a monitor that cries wolf is a monitor people mute.
 *
 * This is not the watchdog's cadence. The watchdog sweeps every 10-15 seconds
 * (AR-06) and arrives with the safety loop in M2; this is only how long the
 * API waits before reporting that the worker has stopped.
 */
export const WORKER_STALE_AFTER_MS = 180_000;

export const healthResponseSchema = z
  .object({
    status: z
      .enum(['ok', 'degraded'])
      .describe(
        'ok when the worker has checked in recently; degraded when it has not, ' +
          'which means nothing is watching the journeys.',
      ),
    checkedAt: z
      .string()
      .describe('When the server answered, from the database clock (REL-01), as RFC 3339.'),
    worker: z
      .object({
        lastBeatAt: z
          .string()
          .nullable()
          .describe('The worker’s last check-in, or null if it has never checked in.'),
        silentForMs: z
          .number()
          .int()
          .nonnegative()
          .nullable()
          .describe('How long the worker has been silent, or null if it has never checked in.'),
      })
      .describe('What the API can see of the worker.'),
  })
  .describe('Whether the safety system as a whole is working, not just this process.');

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const health = oc
  .route({
    method: 'GET',
    path: '/health',
    summary: 'Is the safety system working?',
    description:
      'Returns 200 whenever the API is up. Read `status` in the body to tell whether ' +
      'the worker is still running, because an API with no worker raises no alerts.',
  })
  .output(healthResponseSchema);
