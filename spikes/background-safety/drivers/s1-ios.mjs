// SPIKE-01-AC5 (S1), iOS simulator: 45 minutes with the app in the background.
// The device is not locked: simctl has no lock command, and this simulator
// runs without a window, so no key can lock it. The results say so.
//   node drivers/s1-ios.mjs [--dry]
import * as ios from './lib/ios.mjs';
import { iosDevice, runJourney } from './lib/journey.mjs';
import { hold, main, minutes, openRun, readArguments, seconds } from './lib/run.mjs';

main(async () => {
  const { dry } = readArguments();
  const run = await openRun({ scenario: 's1', platform: 'ios', dry, build: ios.BUILD });
  const device = await iosDevice(run);
  try {
    await runJourney(run, device, {
      during: async () => {
        await hold(run, seconds(20), 'the first uploads, in the foreground');
        ios.background(run, device.udid);
        await hold(run, (dry ? minutes(3) : minutes(45)) + seconds(30), 'S1: the journey');
      },
    });
  } finally {
    device.tearDown();
    await run.close({ locked: false, lockNote: 'simctl cannot lock the simulator' });
  }
});
