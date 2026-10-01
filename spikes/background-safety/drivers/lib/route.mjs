// SPIKE-01-AC4: replays the synthetic route on the Mac's clock. Each point is
// set at its own time from the replay's start, through the platform's setter.
// Nothing here prints a position: the driver's log gets only the point's index.
import { performance } from 'node:perf_hooks';

import { buildRoute } from '../../routes/route.mjs';

/** One seed for every run and both platforms (AC4: the same route every time). */
export const ROUTE_SEED = 1;

/** The route's first point, for the position the device has before a journey starts. */
export const firstPoint = () => buildRoute({ seed: ROUTE_SEED }).points[0];

/**
 * Starts the replay. `setPosition({ lat, lon })` is the platform's setter;
 * `log` gets progress without positions. Returns `stop()`.
 */
export function replayRoute({ setPosition, log }) {
  const { points } = buildRoute({ seed: ROUTE_SEED });
  const start = performance.now();
  let timer = null;
  let stopped = false;
  let failures = 0;

  const step = async (i) => {
    if (stopped || i >= points.length) {
      if (!stopped) log('route-finished', { points: points.length });
      return;
    }
    try {
      await setPosition(points[i]);
    } catch (error) {
      failures += 1;
      log('route-step-failed', { index: i, error: error?.code ?? error?.name ?? 'error' });
    }
    if (i % 30 === 0) log('route-progress', { index: i, of: points.length });
    const next = i + 1;
    if (next < points.length) {
      timer = setTimeout(() => step(next), Math.max(0, start + points[next].t - performance.now()));
    } else {
      log('route-finished', { points: points.length });
    }
  };
  log('route-started', { seed: ROUTE_SEED, points: points.length });
  step(0);
  return {
    stop: () => {
      stopped = true;
      clearTimeout(timer);
      log('route-stopped', { failures });
      return failures;
    },
  };
}
