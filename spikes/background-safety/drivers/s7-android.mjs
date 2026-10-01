// SPIKE-01-AC11 (S7), Android emulator: the location permission reduced
// mid-journey, one way per run, as the change in Settings does:
//   background  `pm revoke` of ACCESS_BACKGROUND_LOCATION ("all the time" to "only while using")
//   fine        `pm revoke` of ACCESS_FINE_LOCATION (precise to approximate)
// "permission-reduced" is marked just before the revoke, so the delay the
// judge measures includes everything after it.
//   node drivers/s7-android.mjs --case background|fine [--dry]
import * as android from './lib/android.mjs';
import { androidDevice, runJourney } from './lib/journey.mjs';
import { APP_ID, hold, main, minutes, openRun, readArguments, seconds, sleep } from './lib/run.mjs';

const REVOKE = {
  background: 'android.permission.ACCESS_BACKGROUND_LOCATION',
  fine: 'android.permission.ACCESS_FINE_LOCATION',
};

main(async () => {
  const { dry, runCase } = readArguments({ cases: Object.keys(REVOKE) });
  const run = await openRun({
    scenario: 's7',
    platform: 'android',
    runCase,
    dry,
    build: android.BUILD,
  });
  const device = await androidDevice(run);
  /** Whether the platform ended the app's process on the change, for the go/no-go (per run). */
  let processEnded = null;
  try {
    await runJourney(run, device, {
      during: async () => {
        await hold(run, dry ? minutes(1.5) : minutes(3), 'S7: moving before the change');
        const pidBefore = android.pidOf();
        await run.mark('permission-reduced');
        android.shell(`pm revoke ${APP_ID} ${REVOKE[runCase]}`);
        await sleep(seconds(3));
        processEnded = pidBefore !== android.pidOf();
        run.log('revoked', { permission: REVOKE[runCase], processEnded });
        await hold(run, dry ? minutes(1.5) : minutes(3), 'S7: watching after the change');
      },
    });
  } finally {
    run.save('crash.txt', android.shell('logcat -b crash -d'));
    device.tearDown();
    await run.close({ revoked: REVOKE[runCase], processEnded });
  }
});
