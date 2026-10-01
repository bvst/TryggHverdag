// SPIKE-01-AC16 (S8), both platforms: the map screen at zoom 10, 14 and 18
// around Galdhøpiggen. A screenshot is taken only once MapLibre has reported
// that the map finished rendering (map.json: "rendered zoom N"), and map.json's
// frame, in screen pixels, is saved with it for the crop.
//
// A map that does not render is the scenario's own outcome, never a thrown
// driver (the code review, 2026-10-01): for each zoom, the last map.json seen
// is saved as zoom-N.json, rendered or not, and readMapRender in the judge
// decides. Only a rendered zoom gets a screenshot.
import { join } from 'node:path';

import { seconds, sleep } from './run.mjs';

export const ZOOMS = [10, 14, 18];
const RENDER_TIMEOUT_MS = seconds(120);

/**
 * `show(zoom)` brings a zoom level up (the first is up when the screen opens);
 * `shoot(file)` takes the screenshot. Returns each zoom's shot, for meta.json:
 * `{ zoom, rendered, file, region }`, with no file where it did not render.
 */
export async function shootZooms(run, device, { show, shoot }) {
  const shots = [];
  for (const [i, zoom] of ZOOMS.entries()) {
    const since = Date.now();
    if (i > 0) await show(zoom);
    let last = null;
    let rendered = false;
    while (Date.now() - since < RENDER_TIMEOUT_MS) {
      const evidence = device.evidence('map.json');
      if (evidence !== null) last = evidence;
      if (evidence?.status === `rendered zoom ${zoom}` && evidence.writtenAt >= since - 1000) {
        rendered = true;
        break;
      }
      await sleep(1000);
    }
    if (last !== null) run.save(`zoom-${zoom}.json`, `${JSON.stringify(last, null, 2)}\n`);
    if (!rendered) {
      run.log('map-not-rendered', { zoom, lastStatus: last?.status ?? null });
      shots.push({ zoom, rendered: false, file: null, region: null });
      continue;
    }
    const file = `zoom-${zoom}.png`;
    await shoot(join(run.dir, file));
    shots.push({ zoom, rendered: true, file, region: last.frame });
  }
  return shots;
}
