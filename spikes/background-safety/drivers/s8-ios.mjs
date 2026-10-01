// SPIKE-01-AC16 (S8), iOS simulator: MapLibre draws Kartverket's tiles at
// three zoom levels, with no crash report for the app. Outside the go/no-go.
//   node drivers/s8-ios.mjs [--dry]
import { copyFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import * as ios from './lib/ios.mjs';
import { iosDevice } from './lib/journey.mjs';
import { runFlow } from './lib/maestro.mjs';
import { main, openRun, readArguments } from './lib/run.mjs';
import { shootZooms } from './lib/s8.mjs';

main(async () => {
  const { dry } = readArguments();
  const run = await openRun({ scenario: 's8', platform: 'ios', dry, build: ios.BUILD });
  const device = await iosDevice(run);
  const since = Date.now();
  let shots = [];
  let processRunning = null;
  try {
    await device.setUp();
    await device.tap('open-map');
    shots = await shootZooms(run, device, {
      show: (zoom) => runFlow(run, device.udid, 'ios-zoom.yaml', { ZOOM: zoom }),
      shoot: async (file) => ios.screenshot(run, device.udid, file),
    });
    processRunning = ios.appRunning(device.udid);
  } finally {
    const reports = ios.crashReports(since);
    for (const report of reports) copyFileSync(report, join(run.dir, basename(report)));
    device.tearDown();
    await run.close({
      shots,
      processRunning,
      crashReports: reports.map((report) => basename(report)),
    });
  }
});
