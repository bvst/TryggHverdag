// SPIKE-01-AC9 (S5), Android emulator: the fixed, content-free alert, posted by
// the app on its high-priority channel while Do Not Disturb is on (priority
// mode) and the ringer is silent. The channel's override is granted by script
// before the app creates its channels, as a responder would grant it in setup.
// The system's notification record and audio record are saved for the readers.
//   node drivers/s5-android.mjs [--dry]
import * as android from './lib/android.mjs';
import { androidDevice } from './lib/journey.mjs';
import { fixed, hold, main, openRun, readArguments, seconds } from './lib/run.mjs';

main(async () => {
  const { dry } = readArguments();
  const run = await openRun({ scenario: 's5', platform: 'android', dry, build: android.BUILD });
  const device = await androidDevice(run);
  try {
    await device.setUp({ dnd: true });
    run.save('channels-before.txt', android.shell('dumpsys notification --noredact'));
    await device.tap('alert-soon');
    // The alert fires 10 s after the tap: silence the device before it does.
    android.shell('cmd notification set_dnd priority');
    android.shell('cmd audio set-ringer-mode SILENT');
    android.screenOff(run);
    run.log('silenced', { dnd: 'priority', ringer: 'SILENT' });
    await hold(run, seconds(25), 'S5: the alert fires 10 s after the tap');
    run.save('notification.txt', android.shell('dumpsys notification --noredact'));
    run.save('audio.txt', android.shell('dumpsys audio'));
    run.save('expected-alert.json', `${JSON.stringify(fixed.alert, null, 2)}\n`);
  } finally {
    run.save('crash.txt', android.shell('logcat -b crash -d'));
    device.tearDown();
    await run.close({ silenced: { dnd: 'priority', ringer: 'SILENT' } });
  }
});
