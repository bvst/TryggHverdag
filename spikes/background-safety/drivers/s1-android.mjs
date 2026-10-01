// SPIKE-01-AC5 (S1), Android emulator: 45 minutes with the screen off and the
// virtual battery unplugged, nothing else forced. With --tcpdump, the emulator
// is booted with a network capture of the whole run (AC12), and must have no
// Google account.
//
// With --case exempt (the owner's Q4, 2026-10-01), the same journey with the
// battery-optimisation exemption granted by script first, as the app's setup
// would ask the user (freshApp's `exempt`, as S3's exempt case uses), and
// shown in force before the screen goes off: deviceidle's list holds the app,
// and the app's own `exempt: true` report reached the receiver (meta.json,
// exemptionInForce). Everything else is S1's: screen off, battery unplugged,
// no forced Doze, the same route and seed. The run id carries the case
// (…-s1-android-exempt-N), so its runs never count as the plain case's.
//   node drivers/s1-android.mjs [--case exempt] [--dry] [--tcpdump]
import { join } from 'node:path';

import * as android from './lib/android.mjs';
import { androidDevice, arrivalAfterStart, runJourney } from './lib/journey.mjs';
import { APP_ID, hold, main, minutes, openRun, readArguments, seconds } from './lib/run.mjs';

/** How long the app may take to report the exemption, once the journey is under way. */
const REPORT_WAIT_MS = minutes(3);

/**
 * The exemption shown in force before the screen goes off: deviceidle's own
 * list holds the app, and the app's own report (`exempt: true`) has reached
 * the receiver since the journey started. When it is not shown, the run cannot
 * be an S1 run with the exemption: that is a break (the harness, not the SDK),
 * and the driver stops rather than spend 45 min on an invalid run.
 */
async function exemptionShown(run) {
  const listed = android.shell('dumpsys deviceidle whitelist').includes(APP_ID);
  const report = await arrivalAfterStart(
    run,
    'the app to report that it is exempt',
    (arrival) => arrival.exempt === true,
    REPORT_WAIT_MS,
  ).catch(() => null);
  const shown = { listed, reportedAt: report?.at ?? null, recordId: report?.recordId ?? null };
  run.log('exemption', shown);
  if (!listed || report === null) {
    const missing = !listed
      ? "deviceidle's list does not hold the app"
      : 'the app never reported it';
    run.addBreak(`the exemption was not shown in force before the screen went off: ${missing}`);
    throw new Error('the exemption was not shown in force; the run stops (a break)');
  }
  return shown;
}

main(async () => {
  const { dry, runCase, tcpdump } = readArguments({ cases: ['exempt'], optionalCase: true });
  const exempt = runCase === 'exempt';
  const run = await openRun({
    scenario: 's1',
    platform: 'android',
    runCase,
    dry,
    build: android.BUILD,
  });
  const capture = tcpdump ? join(run.dir, 'capture.pcap') : null;
  const device = await androidDevice(run, { tcpdump: capture });
  if (tcpdump && device.emulator.accounts !== '0') {
    throw new Error(
      `AC12 needs no Google account on the device, and it has ${device.emulator.accounts}`,
    );
  }
  /**
   * With the exemption: that it was in force before the screen went off, as
   * deviceidle's own list shows it and as the app itself reported it.
   */
  let exemptionInForce = null;
  try {
    await runJourney(run, device, {
      grants: { exempt },
      during: async () => {
        await hold(run, seconds(20), 'the first uploads, with the screen on');
        if (exempt) exemptionInForce = await exemptionShown(run);
        android.shell('dumpsys battery unplug');
        android.screenOff(run);
        await hold(run, (dry ? minutes(3) : minutes(45)) + seconds(30), 'S1: the journey');
      },
    });
  } finally {
    run.save('crash.txt', android.shell('logcat -b crash -d'));
    device.tearDown();
    await run.close({
      exemption: exempt,
      exemptionInForce,
      capture: capture === null ? null : 'capture.pcap',
      wifiOffForCapture: capture !== null,
      emulator: device.emulator,
    });
  }
});
