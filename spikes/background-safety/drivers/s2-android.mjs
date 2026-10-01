// SPIKE-01-AC6 (S2), Android emulator: the app is ended mid-journey, one way
// per run, and the reminder must come before D-021's 5 minutes.
//   swipe      swiped away from the recent-apps screen
//   lmk        its process killed with SIGKILL, as the low-memory killer does
//   forcestop  Settings' Force stop, recorded and not judged
// Exact alarms are granted first, as a responder's setup would. The reminder's
// delivery is read from the platform's own record (dumpsys notification). The
// watch after the app was ended runs until 6.5 min after the last arrival, up
// to 15 min (lib/journey.mjs, watchAfterEnded).
//   node drivers/s2-android.mjs --case swipe|lmk|forcestop [--dry]
import * as android from './lib/android.mjs';
import { androidDevice, runJourney, watchAfterEnded } from './lib/journey.mjs';
import { APP_ID, hold, main, minutes, openRun, readArguments, seconds, sleep } from './lib/run.mjs';

const hasTask = () => android.shell('am stack list').includes(APP_ID);

async function endApp(run, how) {
  if (how === 'swipe') {
    android.shell('input keyevent KEYCODE_APP_SWITCH');
    await sleep(seconds(3));
    // A finger's drag up the app's card. `input swipe` does not dismiss a card
    // in this launcher (checked 2026-09-30); separate touch events do.
    const moves = [1150, 1000, 850, 700, 550, 400, 250, 100]
      .map((y) => `input motionevent MOVE 540 ${y}`)
      .join('; ');
    android.shell(`input motionevent DOWN 540 1300; ${moves}; input motionevent UP 540 100`);
    await sleep(seconds(2));
    android.shell('input keyevent KEYCODE_HOME');
    if (hasTask()) throw new Error('the swipe did not remove the app from recents');
  } else if (how === 'lmk') {
    const pid = android.pidOf();
    if (pid === null) throw new Error('the app has no process to kill');
    android.shell(`run-as ${APP_ID} kill -9 ${pid}`);
  } else {
    android.shell(`am force-stop ${APP_ID}`);
  }
  await sleep(seconds(5));
  run.log('app-ended', { how, processAfter5s: android.pidOf() !== null });
}

main(async () => {
  const { dry, runCase } = readArguments({ cases: ['swipe', 'lmk', 'forcestop'] });
  const run = await openRun({
    scenario: 's2',
    platform: 'android',
    runCase,
    dry,
    build: android.BUILD,
  });
  const device = await androidDevice(run);
  try {
    await runJourney(run, device, {
      grants: { exactAlarm: true },
      during: async () => {
        await hold(run, dry ? minutes(1.5) : minutes(5), 'S2: the journey before the app is ended');
        const endedAt = Date.now();
        await run.mark('app-ended');
        await endApp(run, runCase);
        await watchAfterEnded(run, { endedAt, dry });
        run.log('process-at-end', { running: android.pidOf() !== null });
      },
    });
  } finally {
    run.save('notification.txt', android.shell('dumpsys notification --noredact'));
    run.save('alarm.txt', android.shell(`dumpsys alarm | grep -A4 -i ${APP_ID} || true`));
    run.save('crash.txt', android.shell('logcat -b crash -d'));
    device.tearDown();
    await run.close({ ended: runCase, judged: runCase !== 'forcestop' });
  }
});
