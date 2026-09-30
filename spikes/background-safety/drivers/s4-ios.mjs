// SPIKE-01-AC8 (S4), iOS simulator: the simulator shares the Mac's network and
// has no airplane mode, so the receiver refuses uploads (503) for at least 3
// minutes instead. The radio is not off; the results say so. See lib/s4.mjs.
//   node drivers/s4-ios.mjs [--dry]
import * as ios from './lib/ios.mjs';
import { iosDevice, runJourney } from './lib/journey.mjs';
import { offlineWindow } from './lib/s4.mjs';
import { main, openRun, readArguments } from './lib/run.mjs';

main(async () => {
  const { dry } = readArguments();
  const run = await openRun({ scenario: 's4', platform: 'ios', dry, build: ios.BUILD });
  const device = await iosDevice(run);
  try {
    await runJourney(run, device, {
      during: () =>
        offlineWindow(run, device, {
          dry,
          cutOff: () => run.refuse(),
          reconnect: () => run.accept(),
        }),
    });
  } finally {
    device.tearDown();
    await run.close({ offline: 'the receiver refused uploads; the radio was not off' });
  }
});
