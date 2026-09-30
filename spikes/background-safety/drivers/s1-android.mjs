// SPIKE-01-AC5 (S1), Android emulator: 45 minutes with the screen off and the
// virtual battery unplugged, nothing else forced. With --tcpdump, the emulator
// is booted with a network capture of the whole run (AC12), and must have no
// Google account.
//   node drivers/s1-android.mjs [--dry] [--tcpdump]
import { join } from 'node:path';

import * as android from './lib/android.mjs';
import { androidDevice, runJourney } from './lib/journey.mjs';
import { hold, main, minutes, openRun, readArguments, seconds } from './lib/run.mjs';

main(async () => {
  const { dry, tcpdump } = readArguments();
  const run = await openRun({ scenario: 's1', platform: 'android', dry, build: android.BUILD });
  const capture = tcpdump ? join(run.dir, 'capture.pcap') : null;
  const device = await androidDevice(run, { tcpdump: capture });
  if (tcpdump && device.emulator.accounts !== '0') {
    throw new Error(
      `AC12 needs no Google account on the device, and it has ${device.emulator.accounts}`,
    );
  }
  try {
    await runJourney(run, device, {
      during: async () => {
        await hold(run, seconds(20), 'the first uploads, with the screen on');
        android.shell('dumpsys battery unplug');
        android.screenOff(run);
        await hold(run, (dry ? minutes(3) : minutes(45)) + seconds(30), 'S1: the journey');
      },
    });
  } finally {
    run.save('crash.txt', android.shell('logcat -b crash -d'));
    device.tearDown();
    await run.close({
      capture: capture === null ? null : 'capture.pcap',
      wifiOffForCapture: capture !== null,
      emulator: device.emulator,
    });
  }
});
