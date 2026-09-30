// SPIKE-01-AC8 (S4), Android emulator: airplane mode on for at least 3
// minutes mid-walk, then off. See lib/s4.mjs for the windows and `held`.
//   node drivers/s4-android.mjs [--dry]
import * as android from './lib/android.mjs';
import { androidDevice, runJourney } from './lib/journey.mjs';
import { offlineWindow } from './lib/s4.mjs';
import { main, openRun, readArguments } from './lib/run.mjs';

main(async () => {
  const { dry } = readArguments();
  const run = await openRun({ scenario: 's4', platform: 'android', dry, build: android.BUILD });
  const device = await androidDevice(run);
  try {
    await runJourney(run, device, {
      during: () =>
        offlineWindow(run, device, {
          dry,
          cutOff: async () => {
            android.shell('cmd connectivity airplane-mode enable');
            run.log('airplane-mode', { on: true });
          },
          reconnect: async () => {
            android.shell('cmd connectivity airplane-mode disable');
            run.log('airplane-mode', { on: false });
          },
        }),
    });
  } finally {
    run.save('crash.txt', android.shell('logcat -b crash -d'));
    device.tearDown();
    await run.close({ offline: 'airplane mode' });
  }
});
