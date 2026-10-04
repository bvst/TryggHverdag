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
 * The worker's beat follows each good sweep of the watchdog (D-108), every
 * 10 seconds while the watchdog works, and stops when a sweep fails or finds a
 * journey it cannot move. Three minutes was chosen when the beat came once a
 * minute, so that ordinary jitter never pages; a monitor that cries wolf is a
 * monitor people mute. Since the beat follows the sweep, a stale beat means
 * the watchdog has not swept successfully for three minutes, which pages as a
 * stopped worker does (D-065, D-079). The minute check-in with
 * Healthchecks.io notices sooner: it stops once the beat is 30 seconds old.
 *
 * This is not the watchdog's cadence; it is only how long the API waits
 * before reporting that nothing is watching the journeys.
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
    checkedAt: z.iso
      .datetime()
      .describe('When the server answered, from the database clock (REL-01), as RFC 3339.'),
    worker: z
      .object({
        lastBeatAt: z.iso
          .datetime()
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
