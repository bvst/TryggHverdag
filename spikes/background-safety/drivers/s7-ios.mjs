// SPIKE-01-AC11 (S7), iOS simulator: location reduced from "Always" to
// "While using" with `simctl privacy` (revoke location-always, grant
// location). simctl has no precise-to-approximate change: that case is not
// shown on simulators. "permission-reduced" is marked just before the change.
//   node drivers/s7-ios.mjs --case always-to-inuse [--dry]
import * as ios from './lib/ios.mjs';
import { iosDevice, runJourney } from './lib/journey.mjs';
import { hold, main, minutes, openRun, readArguments, seconds, sleep } from './lib/run.mjs';

main(async () => {
  const { dry, runCase } = readArguments({ cases: ['always-to-inuse'] });
  const run = await openRun({ scenario: 's7', platform: 'ios', runCase, dry, build: ios.BUILD });
  const device = await iosDevice(run);
  /** Whether the platform ended the app's process on the change, for the go/no-go (per run). */
  let processEnded = null;
  try {
    await runJourney(run, device, {
      during: async () => {
        await hold(run, dry ? minutes(1.5) : minutes(3), 'S7: moving before the change');
        await run.mark('permission-reduced');
        ios.privacy(run, device.udid, 'revoke', 'location-always');
        ios.privacy(run, device.udid, 'grant', 'location');
        await sleep(seconds(3));
        const processRunning = ios.appRunning(device.udid);
        processEnded = !processRunning;
        run.log('reduced', { processRunning });
        await hold(run, dry ? minutes(1.5) : minutes(3), 'S7: watching after the change');
      },
    });
  } finally {
    device.tearDown();
    await run.close({
      reduced: 'location-always revoked, location (while using) granted',
      processEnded,
    });
  }
});
