// SPIKE-01-AC6 (S2), iOS simulator: the app ended with `simctl terminate`
// mid-journey (not proven equal to a user's swipe; the results say so). The
// reminder's delivery is read from the platform's list of delivered
// notifications, as the app gives it when next opened (delivered.json, ms).
// The watch after the app was ended runs until 6.5 min after the last
// arrival, up to 15 min (lib/journey.mjs, watchAfterEnded).
//   node drivers/s2-ios.mjs [--dry]
import * as ios from './lib/ios.mjs';
import { iosDevice, runJourney, watchAfterEnded } from './lib/journey.mjs';
import {
  hold,
  main,
  minutes,
  openRun,
  readArguments,
  seconds,
  sleep,
  waitFor,
} from './lib/run.mjs';

main(async () => {
  const { dry } = readArguments();
  const run = await openRun({ scenario: 's2', platform: 'ios', dry, build: ios.BUILD });
  const device = await iosDevice(run);
  try {
    await runJourney(run, device, {
      during: async () => {
        await hold(run, dry ? minutes(1.5) : minutes(5), 'S2: the journey before the app is ended');
        const endedAt = Date.now();
        await run.mark('app-ended');
        ios.terminate(run, device.udid);
        await sleep(seconds(5));
        run.log('app-ended', {
          how: 'simctl terminate',
          processAfter5s: ios.appRunning(device.udid),
        });
        await watchAfterEnded(run, { endedAt, dry });
      },
    });
    // After the window: the app's own read of the delivered list.
    const before = Date.now();
    ios.launch(run, device.udid);
    const delivered = await waitFor(
      'the app to write its delivered list',
      () => {
        const file = ios.readEvidence(device.udid, 'delivered.json');
        return file !== null && file.writtenAt >= before ? file : null;
      },
      { timeoutMs: seconds(60) },
    );
    run.save('delivered.json', `${JSON.stringify(delivered, null, 2)}\n`);
  } finally {
    device.tearDown();
    await run.close({ ended: 'simctl terminate' });
  }
});
