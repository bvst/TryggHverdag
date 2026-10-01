// SPIKE-01-AC16 (S8), Android emulator: MapLibre draws Kartverket's tiles at
// three zoom levels, with no native crash, on the 16 KB-page image. With
// --tcpdump the emulator is booted with a network capture of the run (the
// destinations are recorded, not judged). Outside the go/no-go. A map that did
// not render, and zipalign's result, are recorded for the judge, never thrown.
//   node drivers/s8-android.mjs [--dry] [--tcpdump]
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import * as android from './lib/android.mjs';
import { androidDevice } from './lib/journey.mjs';
import { main, openRun, readArguments } from './lib/run.mjs';
import { shootZooms } from './lib/s8.mjs';

main(async () => {
  const { dry, tcpdump } = readArguments();
  const run = await openRun({ scenario: 's8', platform: 'android', dry, build: android.BUILD });
  const capture = tcpdump ? join(run.dir, 'capture.pcap') : null;
  const device = await androidDevice(run, { tcpdump: capture });
  let shots = [];
  let processRunning = null;
  try {
    await device.setUp();
    android.shell('logcat -b crash -c');
    await device.tap('open-map');
    shots = await shootZooms(run, device, {
      show: (zoom) => device.tap(`zoom-${zoom}`),
      shoot: async (file) => {
        writeFileSync(
          file,
          execFileSync(android.ADB_PATH, ['exec-out', 'screencap', '-p'], { maxBuffer: 1 << 26 }),
        );
        run.log('screenshot', { file });
      },
    });
    processRunning = android.pidOf() !== null;
  } finally {
    run.save('crash.txt', android.shell('logcat -b crash -d'));
    // zipalign's output and exit code, for readAlignment: the judge decides.
    const { text, exitCode } = android.alignment();
    run.save('zipalign.txt', text);
    device.tearDown();
    await run.close({
      shots,
      processRunning,
      zipalignExitCode: exitCode,
      capture: capture === null ? null : 'capture.pcap',
      wifiOffForCapture: capture !== null,
      emulator: device.emulator,
    });
  }
});
