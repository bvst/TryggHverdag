// SPIKE-01-AC8 (S4), both platforms: 3 minutes moving, cut off for at least
// 3 minutes, then watched for at least 5 minutes after reconnecting.
//
// `held`, the IDs the SDK held when the window closed, comes from the app's
// own snapshot of the SDK's store (held.json: IDs only, written to a local file
// on each location and upload result, never sent). The driver reads it just
// before reconnecting, so it cannot be mistaken for an upload or delay one.
import { hold, minutes, seconds } from './run.mjs';

export async function offlineWindow(run, device, { dry, cutOff, reconnect }) {
  await hold(run, dry ? minutes(1) : minutes(3), 'S4: moving before the cut');
  await run.mark('offline-started');
  await cutOff();
  await hold(run, (dry ? minutes(1) : minutes(3)) + seconds(10), 'S4: offline');
  const held = device.evidence('held.json');
  if (held === null) throw new Error('the app wrote no held.json, so the held IDs are unknown');
  run.save('held.json', `${JSON.stringify({ ...held, readAt: Date.now() }, null, 2)}\n`);
  run.log('held', { count: held.ids.length, writtenAt: held.writtenAt });
  await run.mark('offline-ended');
  await reconnect();
  await hold(
    run,
    (dry ? minutes(1.5) : minutes(5)) + seconds(30),
    'S4: watching after reconnecting',
  );
}
