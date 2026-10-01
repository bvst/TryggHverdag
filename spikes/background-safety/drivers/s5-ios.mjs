// SPIKE-01-AC9 (S5), iOS simulator: the fixed, content-free alert delivered as
// a push with `simctl push` (no Apple servers), at the Time Sensitive level.
// Pushed twice: with the app in front, where it keeps the payload exactly as it
// arrived (received.json), and with the app in the background, where it is
// read from the delivered list when the app is next opened (delivered.json).
// The simulator has no silent switch and no sound check (not shown). A
// foreground push the app never recorded is recorded as `received: null` for
// the judge, never thrown; meta.json keeps when the app went to the
// background (`backgroundAt`), which "presented" is measured from.
//   node drivers/s5-ios.mjs [--dry]
import { join } from 'node:path';

import * as ios from './lib/ios.mjs';
import { iosDevice } from './lib/journey.mjs';
import { fixed, hold, main, openRun, readArguments, seconds, waitFor } from './lib/run.mjs';

/** The only payload sent: the fixed text, the sound, the Time Sensitive level. Nothing else. */
const payload = () => ({
  aps: {
    alert: { title: fixed.alert.title, body: fixed.alert.body },
    sound: 'default',
    'interruption-level': 'time-sensitive',
  },
});

main(async () => {
  const { dry } = readArguments();
  const run = await openRun({ scenario: 's5', platform: 'ios', dry, build: ios.BUILD });
  const device = await iosDevice(run);
  const file = join(run.dir, 'payload.json');
  run.save('payload.json', `${JSON.stringify(payload(), null, 2)}\n`);
  /** The foreground push as the app recorded it, or null when it recorded none: an outcome, not a throw. */
  let received = null;
  /** When the app went to the background: a delivery after it is the background push's. */
  let backgroundAt = null;
  try {
    await device.setUp();
    const before = Date.now();
    ios.push(run, device.udid, file);
    received = await waitFor(
      'the app to record the pushed alert',
      () => {
        const evidence = device.evidence('received.json');
        return evidence !== null && evidence.writtenAt >= before ? evidence : null;
      },
      { timeoutMs: seconds(30) },
    ).catch(() => null);
    if (received === null) run.log('foreground-push-not-recorded', { waited: '30 s' });
    else run.save('received.json', `${JSON.stringify(received, null, 2)}\n`);
    ios.screenshot(run, device.udid, join(run.dir, 'foreground.png'));

    backgroundAt = ios.background(run, device.udid);
    await hold(run, seconds(3), 'the app in the background');
    ios.push(run, device.udid, file);
    await hold(run, seconds(5), 'S5: the alert, delivered in the background');
    ios.screenshot(run, device.udid, join(run.dir, 'background.png'));
    const reopened = Date.now();
    ios.launch(run, device.udid);
    const delivered = await waitFor(
      'the app to write its delivered list',
      () => {
        const evidence = device.evidence('delivered.json');
        return evidence !== null && evidence.writtenAt >= reopened ? evidence : null;
      },
      { timeoutMs: seconds(60) },
    );
    run.save('delivered.json', `${JSON.stringify(delivered, null, 2)}\n`);
  } finally {
    device.tearDown();
    await run.close({
      interruptionLevel: 'time-sensitive',
      received: received === null ? null : 'received.json',
      backgroundAt,
    });
  }
});
