// SPIKE-01-AC16 (S8), both platforms: the map screen at zoom 10, 14 and 18
// around Galdhøpiggen. Each screenshot is taken only once MapLibre has
// reported that the map finished rendering (map.json: "rendered zoom N"), and
// map.json's frame, in screen pixels, is saved with it for the crop.
import { join } from 'node:path';

import { seconds, waitFor } from './run.mjs';

export const ZOOMS = [10, 14, 18];

/**
 * `show(zoom)` brings a zoom level up (the first is up when the screen opens);
 * `shoot(file)` takes the screenshot.
 */
export async function shootZooms(run, device, { show, shoot }) {
  const shots = [];
  for (const [i, zoom] of ZOOMS.entries()) {
    const since = Date.now();
    if (i > 0) await show(zoom);
    const map = await waitFor(
      `the map to finish rendering at zoom ${zoom}`,
      () => {
        const evidence = device.evidence('map.json');
        return evidence?.status === `rendered zoom ${zoom}` && evidence.writtenAt >= since - 1000
          ? evidence
          : null;
      },
      { timeoutMs: seconds(120), everyMs: 1000 },
    );
    const file = `zoom-${zoom}.png`;
    await shoot(join(run.dir, file));
    run.save(`zoom-${zoom}.json`, `${JSON.stringify(map, null, 2)}\n`);
    shots.push({ zoom, file, region: map.frame });
  }
  return shots;
}
