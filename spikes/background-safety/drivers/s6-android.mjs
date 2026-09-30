// SPIKE-01-AC10 (S6), Android emulator: the call button, tapped once, with or
// without CALL_PHONE. What happened is read from Telecom's own record
// (`dumpsys telecom`): on this image the console's `gsm list` never lists a
// call (SPIKE-01 AC2 notes). The app's own line says which mechanism ran.
//   node drivers/s6-android.mjs --case without|with [--dry]
import * as android from './lib/android.mjs';
import { androidDevice } from './lib/journey.mjs';
import { APP_ID, hold, main, openRun, readArguments, seconds } from './lib/run.mjs';

main(async () => {
  const { dry, runCase } = readArguments({ cases: ['without', 'with'] });
  const run = await openRun({
    scenario: 's6',
    platform: 'android',
    runCase,
    dry,
    build: android.BUILD,
  });
  const device = await androidDevice(run);
  try {
    await device.setUp({ callPhone: runCase === 'with' });
    run.save('telecom-before.txt', android.shell('dumpsys telecom'));
    await device.tap('call');
    await hold(run, seconds(6), 'S6: the call, or the dialer, after one tap');
    run.log('foreground', {
      activity:
        /topResumedActivity=\S+ \S+ (\S+)/.exec(
          android.shell('dumpsys activity activities'),
        )?.[1] ?? null,
    });
    run.save('telecom.txt', android.shell('dumpsys telecom'));
    android.shell(`am start -n ${APP_ID}/.MainActivity`);
    await hold(run, seconds(3), 'back in the app');
    run.log('app-said', { callResult: android.textOf('call-result') });
  } finally {
    run.save('crash.txt', android.shell('logcat -b crash -d'));
    device.tearDown();
    await run.close({
      callPhone: runCase === 'with',
      number: 'the synthetic number in app/src/fixed.json',
    });
  }
});
