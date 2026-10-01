// SPIKE-01: the journey every S1-S4 and S7 run shares, with one device
// interface for both platforms. The scenario's own steps run between the
// "journey-started" and "journey-ended" marks, while the route replays.
import * as android from './android.mjs';
import * as ios from './ios.mjs';
import { runFlow } from './maestro.mjs';
import { firstPoint, replayRoute } from './route.mjs';
import { APP_ID, minutes, seconds, sleep, waitFor } from './run.mjs';

/** The Android emulator, behind the shared interface. */
export async function androidDevice(run, { tcpdump = null } = {}) {
  const emulator = await android.ensureEmulator(run, { tcpdump });
  // Both families, for the capture reader (the code review's B2).
  run.note('deviceAddresses', android.deviceAddresses());
  return {
    platform: 'android',
    build: android.BUILD,
    emulator,
    /** A fresh app with its grants, the route's first point set, launched and ready. */
    setUp: async (grants = {}) => {
      android.resetDevice(run);
      if (tcpdump !== null) {
        // The emulator's -tcpdump sees only eth0; with Wi-Fi on, the app's
        // traffic, uploads included, leaves through wlan0 and is not captured
        // (checked 2026-09-30). Capture runs therefore go without Wi-Fi.
        android.shell('cmd wifi set-wifi-enabled disabled');
        run.log('wifi-off-for-capture');
      }
      android.freshApp(run, grants);
      await android.setPosition(firstPoint());
      android.launch(run);
      await waitFor('the journey screen', () => android.textOf('start-journey') !== null, {
        timeoutMs: seconds(60),
      });
    },
    tap: (testId) => android.tapId(run, testId),
    setPosition: (point) => android.setPosition(point),
    evidence: (name) => android.readEvidence(name),
    alive: () => android.emulatorAlive(run),
    /** Forced states back, and the app's data cleared, so nothing it queued lingers. */
    tearDown: () => {
      android.resetDevice(run);
      android.shell(`pm clear ${APP_ID}`);
      run.log('app-cleared');
    },
  };
}

/** The iOS simulator, behind the shared interface. */
export async function iosDevice(run) {
  const udid = await ios.ensureSimulator(run);
  return {
    platform: 'ios',
    build: ios.BUILD,
    udid,
    setUp: async () => {
      ios.resetDevice(run, udid);
      ios.freshApp(run, udid);
      await ios.setPosition(udid, firstPoint());
      ios.launch(run, udid);
      await runFlow(run, udid, 'ios-allow-notifications.yaml');
    },
    tap: (testId) => runFlow(run, udid, 'ios-tap.yaml', { TARGET: testId }),
    setPosition: (point) => ios.setPosition(udid, point),
    evidence: (name) => ios.readEvidence(udid, name),
    alive: () => ios.simulatorAlive(run, udid),
    tearDown: () => ios.resetDevice(run, udid),
  };
}

/**
 * One journey: set up, mark "journey-started", tap Start, replay the route,
 * run `during(device)`, then mark "journey-ended" and tear down. The device is
 * checked for life before the end mark, so a device that exited is a break.
 */
export async function runJourney(run, device, { grants = {}, during }) {
  await device.setUp(grants);
  await run.mark('journey-started');
  await device.tap('start-journey');
  const replay = replayRoute({ setPosition: (point) => device.setPosition(point), log: run.log });
  let failures = 0;
  try {
    await during(device);
  } finally {
    failures = replay.stop();
    device.alive();
    await run.mark('journey-ended');
  }
  if (failures > 0) run.addBreak(`${failures} route step(s) could not be set on the device`);
}

/**
 * S2's watch after the app was ended (review loop 1, 2026-10-01). S2 needs 6 min
 * after the "app-ended" mark, or after the last arrival when arrivals stopped
 * after it, so a fixed watch could end too early. This watches until 6.5 min
 * after the later of the two (30 s over, for the platform writing its record),
 * read on the Mac's clock from the receiver's records every 10 s, and stops at
 * `cap` after the app was ended, so arrivals that never stop cannot hold the
 * run. The judge decides what the watch shows; this only says why it stopped.
 */
export async function watchAfterEnded(run, { endedAt, dry }) {
  const needed = dry ? minutes(2) : minutes(6) + seconds(30);
  const cap = dry ? minutes(4) : minutes(15);
  run.log('watch-started', {
    minutesAfterLastArrival: needed / 60_000,
    capMinutes: cap / 60_000,
  });
  for (;;) {
    const last = run
      .records()
      .filter((record) => record.kind === 'arrival' && record.at >= endedAt)
      .at(-1);
    const from = Math.max(endedAt, last?.at ?? endedAt);
    const now = Date.now();
    if (now >= from + needed) {
      run.log('watch-ended', { why: 'watched long enough after the last arrival' });
      return;
    }
    if (now >= endedAt + cap) {
      run.log('watch-ended', { why: 'the cap: arrivals went on' });
      return;
    }
    await sleep(Math.min(seconds(10), from + needed - now, endedAt + cap - now));
  }
}

/** Waits until the receiver holds an arrival after the "journey-started" mark that `match`es. */
export function arrivalAfterStart(run, what, match, timeoutMs) {
  return waitFor(
    what,
    () => {
      const records = run.records();
      const start = records.find((r) => r.kind === 'mark' && r.label === 'journey-started');
      return records.find((r) => r.kind === 'arrival' && start && r.mono > start.mono && match(r));
    },
    { timeoutMs, everyMs: 2000 },
  );
}
