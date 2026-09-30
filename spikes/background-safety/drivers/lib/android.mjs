// SPIKE-01: the Android emulator, for the drivers. The Pixel_8 AVD
// (android-37.2, google_apis_ps16k, x86_64), headless. Colima must be stopped:
// with 16 GB the two do not fit together.
import { execFile, execFileSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { APP_ID, BUILDS, sleep, waitFor } from './run.mjs';

const SDK = join(homedir(), 'Library/Android/sdk');
const ADB = join(SDK, 'platform-tools/adb');
export const ADB_PATH = ADB;
const EMULATOR = join(SDK, 'emulator/emulator');
const ZIPALIGN = join(SDK, 'build-tools/36.0.0/zipalign');
export const APK = join(BUILDS, 'android-app-debug.apk');
export const BUILD = { file: APK, info: join(BUILDS, 'android-build.json') };

/** The permissions every run grants, as a person would at setup. */
const GRANTS = [
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  'android.permission.ACTIVITY_RECOGNITION',
  'android.permission.POST_NOTIFICATIONS',
];

export const adb = (...args) =>
  execFileSync(ADB, args, { encoding: 'utf8', timeout: 120_000, maxBuffer: 1 << 26 });
export const shell = (command) => adb('shell', command);
const quiet = (command) => {
  try {
    return shell(command);
  } catch {
    return null;
  }
};

const booted = () => {
  try {
    return adb('shell', 'getprop sys.boot_completed').trim() === '1';
  } catch {
    return false;
  }
};
const running = () => adb('devices').includes('emulator-');

function colimaStopped() {
  try {
    execFileSync('colima', ['status'], { stdio: 'pipe' });
    return false;
  } catch {
    return true;
  }
}

/**
 * The emulator, booted. With `tcpdump`, it must be started here, so the
 * capture covers the whole run: a running emulator is refused rather than
 * reused.
 */
export async function ensureEmulator(run, { tcpdump = null } = {}) {
  if (!colimaStopped()) throw new Error('Colima is running: stop it first (16 GB, spec R14)');
  if (tcpdump !== null && running()) {
    throw new Error('--tcpdump needs a fresh emulator: stop the running one first (adb emu kill)');
  }
  if (!running()) {
    const args = [
      '-avd',
      'Pixel_8',
      '-no-window',
      '-no-audio',
      '-no-boot-anim',
      '-no-snapshot-save',
    ];
    args.push('-gpu', 'swiftshader_indirect');
    if (tcpdump !== null) args.push('-tcpdump', tcpdump);
    spawn(EMULATOR, args, { stdio: 'ignore', detached: true }).unref();
    run.log('emulator-starting', { tcpdump: tcpdump !== null });
  }
  await waitFor('the emulator to boot', booted, { timeoutMs: 300_000, everyMs: 3000 });
  const accounts = /Accounts: (\d+)/.exec(shell('dumpsys account'))?.[1] ?? 'unknown';
  const pageSize = shell('getconf PAGE_SIZE').trim();
  run.log('emulator-ready', { accounts, pageSize });
  return { accounts, pageSize };
}

/** The emulator's own watch: a break if it exited during the run. */
export function emulatorAlive(run) {
  if (running() && booted()) return true;
  run.addBreak('the Android emulator exited or stopped answering during the run');
  return false;
}

/**
 * Every forced state back to normal. Safe to call when nothing was forced.
 */
export function resetDevice(run) {
  const steps = [
    'cmd connectivity airplane-mode disable',
    'cmd location set-location-enabled true',
    'cmd wifi set-wifi-enabled enabled',
    'dumpsys deviceidle unforce',
    `dumpsys deviceidle whitelist -${APP_ID}`,
    `am set-standby-bucket ${APP_ID} active`,
    'dumpsys battery reset',
    'cmd notification set_dnd off',
    'cmd audio set-ringer-mode NORMAL',
    `cmd notification disallow_dnd ${APP_ID}`,
    `appops set ${APP_ID} SCHEDULE_EXACT_ALARM default`,
    'input keyevent KEYCODE_WAKEUP',
    'wm dismiss-keyguard',
  ];
  for (const step of steps) quiet(step);
  run.log('device-reset', { steps: steps.length });
}

/**
 * The app installed from the kept build, its data cleared (which also clears
 * its queue, its channels and its notifications), and its permissions granted.
 * Options, each a setup step a person would take: CALL_PHONE, exact alarms,
 * the Do Not Disturb override (granted before the app creates its channels),
 * and the battery-optimisation exemption.
 */
export function freshApp(
  run,
  { callPhone = false, exactAlarm = false, dnd = false, exempt = false } = {},
) {
  if (!existsSync(APK)) throw new Error(`no build at ${APK}: build the app first (README)`);
  adb('install', '-r', APK);
  shell(`pm clear ${APP_ID}`);
  for (const permission of GRANTS) shell(`pm grant ${APP_ID} ${permission}`);
  if (callPhone) shell(`pm grant ${APP_ID} android.permission.CALL_PHONE`);
  else quiet(`pm revoke ${APP_ID} android.permission.CALL_PHONE`);
  if (exactAlarm) shell(`appops set ${APP_ID} SCHEDULE_EXACT_ALARM allow`);
  if (dnd) shell(`cmd notification allow_dnd ${APP_ID}`);
  shell(`dumpsys deviceidle whitelist ${exempt ? '+' : '-'}${APP_ID}`);
  run.log('app-fresh', { callPhone, exactAlarm, dnd, exempt });
}

export function launch(run) {
  shell(`am start -W -n ${APP_ID}/.MainActivity`);
  run.log('app-launched');
}

/** The on-screen nodes, each with its testID, text and centre. */
function screenNodes() {
  quiet('uiautomator dump /sdcard/spike-ui.xml');
  const xml = adb('exec-out', 'cat', '/sdcard/spike-ui.xml');
  return [...xml.matchAll(/<node [^>]*>/g)].map(([node]) => {
    const get = (key) => new RegExp(`${key}="([^"]*)"`).exec(node)?.[1] ?? '';
    const [, x1, y1, x2, y2] = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(get('bounds')).map(Number);
    return { id: get('resource-id'), text: get('text'), x: (x1 + x2) >> 1, y: (y1 + y2) >> 1 };
  });
}

/** The text of the element with this testID, or null when it is not on screen. */
export function textOf(testId) {
  return screenNodes().find((node) => node.id === testId)?.text ?? null;
}

/** Taps the element with this testID, scrolling down once if it is not on screen. */
export async function tapId(run, testId, { timeoutMs = 30_000 } = {}) {
  const node = await waitFor(
    `"${testId}" on screen`,
    () => {
      const found = screenNodes().find((candidate) => candidate.id === testId);
      if (!found) quiet('input swipe 540 1800 540 900 300');
      return found;
    },
    { timeoutMs, everyMs: 1000 },
  );
  shell(`input tap ${node.x} ${node.y}`);
  run.log('tap', { testId });
}

/** One of the app's evidence files, parsed, or null when the app has not written it. */
export function readEvidence(name) {
  try {
    return JSON.parse(adb('exec-out', 'run-as', APP_ID, 'cat', `files/${name}`));
  } catch {
    return null;
  }
}

/** Sets the emulator's position, without blocking the driver. Nothing is printed. */
export async function setPosition({ lat, lon }) {
  await promisify(execFile)(ADB, ['emu', 'geo', 'fix', String(lon), String(lat)], {
    timeout: 20_000,
  });
}

/** A dump of one command's output into the run. */
export function dump(run, name, command) {
  run.save(name, shell(command));
}

export const screenOff = (run) => {
  shell('input keyevent KEYCODE_SLEEP');
  run.log('screen-off');
};

export const pidOf = () => quiet(`pidof ${APP_ID}`)?.trim() || null;

/** The installed build's 16 KB alignment, as zipalign reports it. */
export function alignment() {
  const output = execFileSync(ZIPALIGN, ['-c', '-P', '16', '-v', '4', APK], { encoding: 'utf8' });
  return { aligned16k: output.includes('Verification successful'), output };
}

export async function stopEmulator(run) {
  try {
    adb('emu', 'kill');
  } catch {
    // Already gone.
  }
  await sleep(20_000);
  run.log('emulator-stopped');
}
