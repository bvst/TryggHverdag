// SPIKE-01: the iOS simulator, for the drivers. The iPhone 17 on the Mac's
// iOS 26.0 runtime, with the simulator app built on EAS (README). UI taps go
// through Maestro flows (./maestro.mjs); everything else through simctl.
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { APP_ID, BUILDS } from './run.mjs';

export const APP = join(BUILDS, 'ios/SPIKE01.app');
export const BUILD = { file: APP, info: join(BUILDS, 'ios-build.json') };
const DEVICE_NAME = 'iPhone 17';
const RUNTIME = 'com.apple.CoreSimulator.SimRuntime.iOS-26-0';

const simctl = (...args) =>
  execFileSync('xcrun', ['simctl', ...args], {
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 1 << 26,
  });
/** A best-effort simctl call: null, and nothing printed, when it fails. */
const quiet = (...args) => {
  try {
    return execFileSync('xcrun', ['simctl', ...args], {
      encoding: 'utf8',
      timeout: 180_000,
      maxBuffer: 1 << 26,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    return null;
  }
};

/** The iPhone 17 simulator's UDID. */
export function deviceId() {
  const { devices } = JSON.parse(simctl('list', 'devices', '--json'));
  const device = (devices[RUNTIME] ?? []).find((candidate) => candidate.name === DEVICE_NAME);
  if (!device) throw new Error(`no "${DEVICE_NAME}" simulator on ${RUNTIME}`);
  return device.udid;
}

export async function ensureSimulator(run) {
  const udid = deviceId();
  quiet('boot', udid);
  simctl('bootstatus', udid, '-b');
  run.log('simulator-ready', { device: DEVICE_NAME });
  return udid;
}

export function simulatorAlive(run, udid) {
  const { devices } = JSON.parse(simctl('list', 'devices', '--json'));
  const state = (devices[RUNTIME] ?? []).find((candidate) => candidate.udid === udid)?.state;
  if (state === 'Booted') return true;
  run.addBreak(`the iOS simulator was ${state ?? 'gone'} during the run`);
  return false;
}

/**
 * Every forced state back: the simulated position cleared, and the app with
 * its data, its delivered notifications and its permissions removed.
 */
export function resetDevice(run, udid) {
  quiet('location', udid, 'clear');
  quiet('terminate', udid, APP_ID);
  quiet('privacy', udid, 'reset', 'all', APP_ID);
  quiet('uninstall', udid, APP_ID);
  run.log('device-reset');
}

/** A fresh install with location "always" and motion granted. Notifications are allowed by a flow. */
export function freshApp(run, udid) {
  if (!existsSync(APP))
    throw new Error(`no build at ${APP}: download the EAS build first (README)`);
  quiet('uninstall', udid, APP_ID);
  simctl('install', udid, APP);
  simctl('privacy', udid, 'grant', 'location-always', APP_ID);
  simctl('privacy', udid, 'grant', 'motion', APP_ID);
  run.log('app-fresh');
}

export function launch(run, udid) {
  simctl('launch', udid, APP_ID);
  run.log('app-launched');
}

export function terminate(run, udid) {
  simctl('terminate', udid, APP_ID);
  run.log('app-terminated');
}

/** Puts the app in the background by bringing Settings to the front. */
export function background(run, udid) {
  simctl('launch', udid, 'com.apple.Preferences');
  run.log('app-backgrounded');
}

export function privacy(run, udid, action, service) {
  simctl('privacy', udid, action, service, APP_ID);
  run.log('privacy', { action, service });
}

/** Sets the simulator's position, without blocking the driver. Nothing is printed. */
export async function setPosition(udid, { lat, lon }) {
  await promisify(execFile)('xcrun', ['simctl', 'location', udid, 'set', `${lat},${lon}`], {
    timeout: 20_000,
  });
}

export function push(run, udid, payloadFile) {
  simctl('push', udid, APP_ID, payloadFile);
  run.log('pushed');
}

export function screenshot(run, udid, file) {
  simctl('io', udid, 'screenshot', '--type=png', file);
  run.log('screenshot', { file });
}

/** One of the app's evidence files, parsed, or null when the app has not written it. */
export function readEvidence(udid, name) {
  const container = quiet('get_app_container', udid, APP_ID, 'data');
  if (container === null) return null;
  try {
    return JSON.parse(readFileSync(join(container.trim(), 'Documents', name), 'utf8'));
  } catch {
    return null;
  }
}

/** Whether the app's process is running. */
export function appRunning(udid) {
  return (quiet('spawn', udid, 'launchctl', 'list') ?? '').includes(APP_ID);
}

/** The app's crash reports written since `since` (ms), as the Mac keeps them for simulators. */
export function crashReports(since) {
  const dir = join(homedir(), 'Library/Logs/DiagnosticReports');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.startsWith('SPIKE01') && name.endsWith('.ips'))
    .map((name) => join(dir, name))
    .filter((file) => statSync(file).mtimeMs >= since);
}

export function shutdown(run, udid) {
  quiet('shutdown', udid);
  run.log('simulator-shut-down');
}
