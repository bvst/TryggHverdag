// SPIKE-01-AC7 (S3), Android emulator: 45 minutes held in stock Android's own
// restrictions (screen off, battery unplugged, deep Doze forced, the app in the
// restricted standby bucket), once with the battery-optimisation exemption and
// once without. "restrictions-started" is marked only once the app's report of
// its exemption state has reached the receiver after the journey started.
//   node drivers/s3-android.mjs --case exempt|not-exempt [--dry]
import * as android from './lib/android.mjs';
import { androidDevice, arrivalAfterStart, runJourney } from './lib/journey.mjs';
import { APP_ID, hold, main, minutes, openRun, readArguments, seconds } from './lib/run.mjs';

main(async () => {
  const { dry, runCase } = readArguments({ cases: ['exempt', 'not-exempt'] });
  const exempt = runCase === 'exempt';
  const run = await openRun({
    scenario: 's3',
    platform: 'android',
    runCase,
    dry,
    build: android.BUILD,
  });
  const device = await androidDevice(run);
  // Android re-promotes a journeying app out of the restricted bucket within a
  // second (checked 2026-09-30: back to 10 or 30, reasons u-mb and s-mb), so the
  // bucket actually in force is recorded at the start and the end.
  const bucket = () => android.shell(`am get-standby-bucket ${APP_ID}`).trim();
  const inForce = {};
  try {
    await runJourney(run, device, {
      grants: { exempt },
      during: async () => {
        await arrivalAfterStart(
          run,
          `a report that the app is ${exempt ? '' : 'not '}exempt`,
          (arrival) => arrival.exempt === exempt,
          minutes(3),
        );
        await run.mark('restrictions-started');
        android.shell('dumpsys battery unplug');
        android.screenOff(run);
        android.shell('dumpsys deviceidle force-idle deep');
        android.shell(`am set-standby-bucket ${APP_ID} restricted`);
        inForce.start = {
          idle: android.shell('dumpsys deviceidle get deep').trim(),
          bucket: bucket(),
        };
        run.log('restrictions', inForce.start);
        await hold(
          run,
          (dry ? minutes(3) : minutes(45)) + seconds(30),
          'S3: held in the restrictions',
        );
        inForce.end = {
          idle: android.shell('dumpsys deviceidle get deep').trim(),
          bucket: bucket(),
        };
        run.log('restrictions-at-end', inForce.end);
      },
    });
  } finally {
    run.save('crash.txt', android.shell('logcat -b crash -d'));
    device.tearDown();
    await run.close({ exemption: exempt, requested: { idle: 'deep', bucket: 45 }, inForce });
  }
});
