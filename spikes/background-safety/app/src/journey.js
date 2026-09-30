// SPIKE-01: the journey. The location SDK's settings, the status the app
// reports, the reminder and the alert. No position is ever shown, stored or
// logged here: the SDK uploads positions itself, from native code.
import * as Notifications from 'expo-notifications';
import { PermissionsAndroid, Platform } from 'react-native';
import BackgroundGeolocation, {
  AccuracyAuthorization,
  AuthorizationStatus,
  DesiredAccuracy,
  LogLevel,
} from 'react-native-background-geolocation';

import fixed from './fixed.json';

/**
 * The receiver on the Mac. The emulator reaches the Mac's loopback as
 * 10.0.2.2; the simulator shares it, and 127.0.0.1 avoids `localhost`
 * resolving to ::1. Cleartext HTTP to these two addresses is spike-only.
 */
export const RECEIVER_URL =
  Platform.OS === 'android'
    ? `http://10.0.2.2:${fixed.receiverPort}/upload/android`
    : `http://127.0.0.1:${fixed.receiverPort}/upload/ios`;

const REMINDER_ID = 'journey-reminder';
/** The reminder rule's ⚙️ 2 minutes. */
const REMINDER_SECONDS = 120;
/** How long after the tap the S5 alert is posted, so the driver can lock the device first. */
const ALERT_DELAY_SECONDS = 10;

export const CHANNELS = { reminder: 'journey-reminder', alert: 'alert' };

/**
 * The SDK's settings. Each one is listed, with its reason, in the README's
 * "Settings used" for M3.
 */
export const SDK_CONFIG = {
  logger: {
    // The SDK's debug mode plays sounds and posts its own notifications.
    debug: false,
    // More verbose levels may write positions to the device log.
    logLevel: LogLevel.Error,
  },
  geolocation: {
    desiredAccuracy: DesiredAccuracy.High,
    // Time-based sampling while moving, so a walker standing still before the
    // SDK notices the stop still uploads. Android samples every 30 s; iOS has
    // no interval setting and delivers continuously.
    distanceFilter: 0,
    locationUpdateInterval: 30_000,
    // S7's report comes from the app, and the SDK's own pop-up would block the
    // drivers.
    disableLocationAuthorizationAlert: true,
    locationAuthorizationRequest: 'Always',
    // The sharing-is-visible story: the iPhone shows its location indicator.
    showsBackgroundLocationIndicator: true,
  },
  app: {
    stopOnTerminate: false,
    startOnBoot: false,
    // Android: after a swipe, events go to the headless task below.
    enableHeadless: true,
    // In the stationary state: an event every 60 s, answered with a position.
    heartbeatInterval: 60,
    // iOS fires heartbeats only with this on (AppConfig, heartbeatInterval).
    preventSuspend: true,
    notification: {
      title: 'SPIKE-01 journey',
      text: 'Location is shared with the spike receiver.',
    },
  },
  http: {
    url: RECEIVER_URL,
    method: 'POST',
    autoSync: true,
    batchSync: false,
  },
};

/** What the screen shows. Counts and names only: never a position. */
export const live = {
  enabled: false,
  moving: null,
  locations: 0,
  heartbeats: 0,
  uploadsOk: 0,
  uploadsFailed: 0,
  lastUploadStatus: null,
  status: null,
  lastReport: null,
  notes: [],
};
const watchers = new Set();

/** Calls `fn` whenever `live` changes; returns the unsubscribe. */
export function watch(fn) {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

function changed(fields) {
  Object.assign(live, fields);
  watchers.forEach((fn) => fn({ ...live }));
}

function note(text) {
  changed({ notes: [text, ...live.notes].slice(0, 8) });
}

const STATUS_NAMES = {
  [AuthorizationStatus.NotDetermined]: 'notDetermined',
  [AuthorizationStatus.Restricted]: 'restricted',
  [AuthorizationStatus.Denied]: 'denied',
  [AuthorizationStatus.Always]: 'always',
  [AuthorizationStatus.WhenInUse]: 'whenInUse',
  [AuthorizationStatus.DeniedAlways]: 'deniedAlways',
};

/**
 * "always/precise", "whenInUse/approximate" and so on. Android's precision is
 * read from its own permission, because the SDK reports full accuracy there
 * whatever the permission says.
 */
function permissionName(provider, finePermission) {
  if (!provider.enabled) return 'servicesOff';
  const status = STATUS_NAMES[provider.status] ?? 'unknown';
  const precise =
    Platform.OS === 'android'
      ? finePermission
      : provider.accuracyAuthorization === AccuracyAuthorization.Full;
  return `${status}/${precise ? 'precise' : 'approximate'}`;
}

async function readStatus(provider) {
  const android = Platform.OS === 'android';
  const [queueCount, state, exempt, fine] = await Promise.all([
    BackgroundGeolocation.getCount(),
    provider ?? BackgroundGeolocation.getProviderState(),
    // iOS has no per-app battery exemption: reported as absent.
    android ? BackgroundGeolocation.deviceSettings.isIgnoringBatteryOptimizations() : null,
    android ? PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION) : null,
  ]);
  return { queueCount, permission: permissionName(state, fine), exempt };
}

/** The status last written into the SDK's upload parameters, and last posted directly. */
let applied = null;
let reported = null;

/**
 * Reads the status and keeps the SDK's `http.params.app` current, so every
 * upload the SDK sends carries it, even when no JavaScript runs. A change of
 * permission or exemption is also posted straight away (and at journey start):
 * S3 and S7 need it to arrive even when the SDK cannot record a position.
 */
export async function refreshStatus({ provider, forceReport = false } = {}) {
  const status = await readStatus(provider);
  const json = JSON.stringify(status);
  if (json !== applied) {
    await BackgroundGeolocation.setConfig({ http: { params: { app: status } } });
    applied = json;
  }
  const key = `${status.permission}|${status.exempt}`;
  if (forceReport || key !== reported) {
    if (await report(status)) reported = key;
  }
  changed({ status });
  return status;
}

/** Posts `{ app }` to the receiver. True once the receiver confirmed it. */
async function report(status) {
  try {
    const response = await fetch(RECEIVER_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app: status }),
    });
    changed({ lastReport: `HTTP ${response.status}` });
    return response.ok;
  } catch (error) {
    changed({ lastReport: `failed (${error?.name ?? 'error'})` });
    return false;
  }
}

/** The reminder rule: a local reminder 2 minutes ahead, moved forward on each sign of life. */
export async function moveReminder() {
  await Notifications.scheduleNotificationAsync({
    identifier: REMINDER_ID,
    content: { title: fixed.reminder.title, body: fixed.reminder.body, sound: true },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: REMINDER_SECONDS,
      channelId: CHANNELS.reminder,
    },
  });
}

/** In the stationary state: move the reminder, refresh the status, record and upload a position. */
export async function onHeartbeat() {
  changed({ heartbeats: live.heartbeats + 1 });
  await Promise.all([moveReminder(), refreshStatus()]);
  try {
    await BackgroundGeolocation.getCurrentPosition({ samples: 1, persist: true, timeout: 30 });
  } catch (error) {
    note(`heartbeat: no position (${typeof error === 'number' ? `code ${error}` : 'error'})`);
  }
}

function onLocation() {
  changed({ locations: live.locations + 1 });
  return moveReminder();
}

function onHttp(event) {
  changed({
    lastUploadStatus: event.status,
    uploadsOk: live.uploadsOk + (event.success ? 1 : 0),
    uploadsFailed: live.uploadsFailed + (event.success ? 0 : 1),
  });
  return refreshStatus();
}

function onProviderChange(provider) {
  note('location permission or services changed');
  return refreshStatus({ provider });
}

function onMotionChange(event) {
  changed({ moving: event.isMoving });
  note(`motion: ${event.isMoving ? 'moving' : 'stationary'}`);
}

/** Loud, never silent: a failed handler shows on the screen. */
const shown = (label, fn) => (event) =>
  Promise.resolve(fn(event)).catch((error) => note(`${label} failed (${error?.name ?? error})`));

/**
 * Registers the SDK's listeners (before `ready`, as the vendor asks), the
 * notification channels, and then the SDK's settings. Returns the unsubscribe.
 */
export async function prepare() {
  const subscriptions = [
    BackgroundGeolocation.onLocation(shown('location', onLocation), (code) =>
      note(`location error (code ${code})`),
    ),
    BackgroundGeolocation.onHeartbeat(shown('heartbeat', onHeartbeat)),
    BackgroundGeolocation.onHttp(shown('upload', onHttp)),
    BackgroundGeolocation.onProviderChange(shown('permission', onProviderChange)),
    BackgroundGeolocation.onMotionChange(shown('motion', onMotionChange)),
    BackgroundGeolocation.onEnabledChange((enabled) => changed({ enabled })),
  ];
  await setUpChannels();
  const state = await BackgroundGeolocation.ready(SDK_CONFIG);
  changed({ enabled: state.enabled, moving: state.isMoving });
  return () => subscriptions.forEach((subscription) => subscription.remove());
}

export async function startJourney() {
  await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  await refreshStatus({ forceReport: true });
  await BackgroundGeolocation.start();
  // Neither device has real motion detection, so the journey starts moving.
  await BackgroundGeolocation.changePace(true);
  await moveReminder();
  note('journey started');
}

export async function stopJourney() {
  await BackgroundGeolocation.stop();
  await Notifications.cancelScheduledNotificationAsync(REMINDER_ID);
  note('journey stopped');
}

/**
 * Android's channels. The alert channel may override Do Not Disturb once the
 * app has that access (granted by the driver, as a responder would in setup),
 * and it sounds on the alarm stream, which the silent ringer does not mute.
 */
async function setUpChannels() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNELS.reminder, {
    name: 'Journey reminder',
    importance: Notifications.AndroidImportance.HIGH,
  });
  await Notifications.setNotificationChannelAsync(CHANNELS.alert, {
    name: 'Alerts',
    importance: Notifications.AndroidImportance.MAX,
    bypassDnd: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    sound: 'default',
    audioAttributes: {
      usage: Notifications.AndroidAudioUsage.ALARM,
      contentType: Notifications.AndroidAudioContentType.SONIFICATION,
    },
    enableVibrate: true,
  });
}

/** S5 on Android: the fixed, content-free alert, posted on the alert channel shortly after the tap. */
export async function alertSoon() {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: fixed.alert.title,
      body: fixed.alert.body,
      sound: 'default',
      priority: Notifications.AndroidNotificationPriority.MAX,
      interruptionLevel: 'timeSensitive',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: ALERT_DELAY_SECONDS,
      channelId: CHANNELS.alert,
    },
  });
  note(`alert scheduled in ${ALERT_DELAY_SECONDS} s`);
}

/**
 * Android, after the app is swiped away: the SDK hands its events to this
 * task, so the heartbeat, the reminder and the status carry on.
 */
export async function headlessTask({ name, params }) {
  switch (name) {
    case 'heartbeat':
      return onHeartbeat();
    case 'location':
      return moveReminder();
    case 'http':
      return refreshStatus();
    case 'providerchange':
      return refreshStatus({ provider: params });
    default:
      return undefined;
  }
}
